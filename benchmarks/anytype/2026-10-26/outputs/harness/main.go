// Native any-sync object-tree experiment. No Anytype application/index layer.
package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"net"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	anystore "github.com/anyproto/any-store"
	"github.com/anyproto/any-sync/accountservice"
	"github.com/anyproto/any-sync/app"
	"github.com/anyproto/any-sync/app/logger"
	"github.com/anyproto/any-sync/commonspace/object/accountdata"
	"github.com/anyproto/any-sync/commonspace/object/acl/list"
	"github.com/anyproto/any-sync/commonspace/object/acl/recordverifier"
	"github.com/anyproto/any-sync/commonspace/object/tree/objecttree"
	"github.com/anyproto/any-sync/commonspace/object/tree/synctree"
	"github.com/anyproto/any-sync/commonspace/object/tree/treechangeproto"
	"github.com/anyproto/any-sync/commonspace/object/tree/treestorage"
	"github.com/anyproto/any-sync/commonspace/spacepayloads"
	"github.com/anyproto/any-sync/commonspace/spacestorage"
	"github.com/anyproto/any-sync/commonspace/spacesyncproto"
	"github.com/anyproto/any-sync/commonspace/sync/objectsync/objectmessages"
	"github.com/anyproto/any-sync/commonspace/sync/syncdeps"
	"github.com/anyproto/any-sync/net/peer"
	"github.com/anyproto/any-sync/net/rpc"
	"github.com/anyproto/any-sync/net/rpc/server"
	"github.com/anyproto/any-sync/net/secureservice"
	"github.com/anyproto/any-sync/net/transport"
	"github.com/anyproto/any-sync/net/transport/yamux"
	"github.com/anyproto/any-sync/nodeconf"
	"github.com/anyproto/any-sync/protobuf"
	"github.com/anyproto/any-sync/util/cidutil"
	"github.com/anyproto/any-sync/util/crypto"
	"go.uber.org/zap"
	"google.golang.org/protobuf/proto"
	"storj.io/drpc"
)

var ctx = context.Background()

func must(err error) {
	if err != nil {
		panic(err)
	}
}
func enc(v any) []byte       { b, e := json.Marshal(v); must(e); return b }
func hash(b []byte) string   { x := sha256.Sum256(b); return hex.EncodeToString(x[:]) }
func ms(t time.Time) float64 { return float64(time.Since(t).Nanoseconds()) / 1e6 }

type Fixture map[string][]map[string]any
type Op struct {
	Collection string          `json:"collection"`
	Index      *int            `json:"index,omitempty"`
	Value      json.RawMessage `json:"value"`
}
type Group struct {
	Name   string
	Ops    []Op
	TreeID string
}

func groups(f Fixture, model string) []*Group {
	var out []*Group
	for _, c := range []string{"issues", "notes"} {
		if model == "opaque_collections" {
			out = append(out, &Group{Name: c, Ops: []Op{{Collection: c, Value: enc(f[c])}}})
			continue
		}
		g := &Group{Name: c}
		for i, r := range f[c] {
			n := i
			op := Op{Collection: c, Index: &n, Value: enc(r)}
			if model == "record_trees" {
				out = append(out, &Group{Name: r["id"].(string), Ops: []Op{op}})
			} else {
				g.Ops = append(g.Ops, op)
			}
		}
		if model == "collection_blocks" {
			out = append(out, g)
		}
	}
	return out
}

// Fixed local peer topology: no node registration, coordinator or discovery.
// SecureService uses NodeTypes to distinguish servers from peers. Client auth is
// explicitly required for both peers below; it verifies signed identities.
type localNodes struct{ nodeconf.Service }

func (*localNodes) Name() string                         { return nodeconf.CName }
func (*localNodes) Init(*app.App) error                  { return nil }
func (*localNodes) Run(context.Context) error            { return nil }
func (*localNodes) Close(context.Context) error          { return nil }
func (*localNodes) NodeTypes(string) []nodeconf.NodeType { return nil }

type config struct{}

func (*config) Name() string           { return "config" }
func (*config) Init(*app.App) error    { return nil }
func (*config) GetYamux() yamux.Config { return yamux.Config{} }
func (*config) GetDrpc() rpc.Config    { return rpc.Config{Stream: rpc.StreamConfig{MaxMsgSizeMb: 10}} }
func (*config) GetSecureService() secureservice.Config {
	return secureservice.Config{RequireClientAuth: true}
}

type account struct{ keys *accountdata.AccountKeys }

func (*account) Name() string                        { return accountservice.CName }
func (*account) Init(*app.App) error                 { return nil }
func (a *account) Account() *accountdata.AccountKeys { return a.keys }

// Status counters are observability only; completion is verified from content.
type status struct{}

func (*status) Name() string                              { return "benchmark.status" }
func (*status) Init(*app.App) error                       { return nil }
func (*status) HeadsChange(string, []string)              {}
func (*status) HeadsReceive(string, string, []string)     {}
func (*status) ObjectReceive(string, string, []string)    {}
func (*status) HeadsApply(string, string, []string, bool) {}
func (*status) UpdateQueueSize(uint64, int, bool)         {}

type endpoint struct {
	spacesyncproto.DRPCSpaceSyncUnimplementedServer
	app      *app.App
	keys     *accountdata.AccountKeys
	db       anystore.DB
	storage  spacestorage.SpaceStorage
	acl      list.AclList
	trees    map[string]synctree.SyncTree
	mu       sync.RWMutex
	bg       sync.WaitGroup
	rpc      server.DRPCServer
	yam      yamux.Yamux
	incoming chan peer.Peer
	remote   peer.Peer
	mc       transport.MultiConn
	client   *client
	received atomic.Int64
	sent     atomic.Int64
}
type accepter struct{ e *endpoint }

func (a accepter) Accept(mc transport.MultiConn) error {
	p, err := peer.NewPeer(mc, a.e.rpc)
	if err == nil {
		a.e.mc = mc
		a.e.incoming <- p
	}
	return err
}
func (e *endpoint) authorize(c context.Context) error {
	key, err := peer.CtxPubKey(c)
	if err != nil {
		return err
	}
	e.acl.RLock()
	defer e.acl.RUnlock()
	if key == nil || e.acl.AclState().Permissions(key).NoPermissions() {
		return errors.New("ACL read access denied")
	}
	return nil
}
func (e *endpoint) get(id string) synctree.SyncTree {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.trees[id]
}
func (e *endpoint) put(t synctree.SyncTree) { e.mu.Lock(); e.trees[t.Id()] = t; e.mu.Unlock() }
func (e *endpoint) ObjectSyncRequestStream(m *spacesyncproto.ObjectSyncMessage, s spacesyncproto.DRPCSpaceSync_ObjectSyncRequestStreamStream) error {
	if err := e.authorize(s.Context()); err != nil {
		return err
	}
	if m.SpaceId != e.storage.Id() {
		return errors.New("wrong space")
	}
	t := e.get(m.ObjectId)
	if t == nil {
		return errors.New("unknown tree")
	}
	pid, err := peer.CtxPeerId(s.Context())
	if err != nil {
		return err
	}
	rq := objectmessages.NewByteRequest(pid, m.SpaceId, m.ObjectId, m.Payload)
	_, err = t.HandleStreamRequest(s.Context(), rq, &status{}, func(m proto.Message) error { return s.MsgSend(m, nil) })
	return err
}
func (e *endpoint) ObjectSync(c context.Context, m *spacesyncproto.ObjectSyncMessage) (*spacesyncproto.ObjectSyncMessage, error) {
	if err := e.authorize(c); err != nil {
		return nil, err
	}
	if m.ObjectId == "benchmark-handshake" {
		return &spacesyncproto.ObjectSyncMessage{}, nil
	}
	if m.SpaceId != e.storage.Id() {
		return nil, errors.New("wrong space")
	}
	e.received.Add(int64(len(encProto(m))))
	t := e.get(m.ObjectId)
	if t == nil {
		return nil, errors.New("unsubscribed tree")
	}
	u := &objectmessages.HeadUpdate{}
	must(u.SetProtoMessage(m))
	rq, err := t.HandleHeadUpdate(c, &status{}, u)
	if err != nil {
		return nil, err
	}
	if rq != nil {
		return nil, errors.New("unexpected missing DAG parents; push did not converge")
	}
	return &spacesyncproto.ObjectSyncMessage{}, nil
}
func encProto(m *spacesyncproto.ObjectSyncMessage) []byte {
	b, err := m.MarshalVT()
	must(err)
	return b
}

type client struct {
	synctree.RequestFactory
	e *endpoint
}

func (c *client) SendTreeRequest(ct context.Context, rq syncdeps.Request, collector syncdeps.ResponseCollector) error {
	return c.e.remote.DoDrpc(ct, func(conn drpc.Conn) error {
		p, err := rq.Proto()
		if err != nil {
			return err
		}
		m := p.(*spacesyncproto.ObjectSyncMessage)
		c.e.sent.Add(int64(len(encProto(m))))
		s, err := spacesyncproto.NewDRPCSpaceSyncClient(conn).ObjectSyncRequestStream(ct, m)
		if err != nil {
			return err
		}
		defer s.Close()
		seen := false
		for {
			r := collector.NewResponse()
			var wire *spacesyncproto.ObjectSyncMessage
			wire, err = s.Recv()
			if errors.Is(err, io.EOF) && seen {
				return nil
			}
			if err != nil {
				return err
			}
			c.e.received.Add(int64(len(encProto(wire))))
			if err = r.(interface{ SetProtoMessage(protobuf.Message) error }).SetProtoMessage(wire); err != nil {
				return err
			}
			if err = collector.CollectResponse(ct, rq.PeerId(), rq.ObjectId(), r); err != nil {
				return err
			}
			seen = true
		}
	})
}
func (c *client) Broadcast(ct context.Context, u *objectmessages.HeadUpdate) error {
	if c.e.remote == nil {
		return nil
	}
	u.SetPeerId(c.e.remote.Id())
	p, err := u.ProtoMessage()
	if err != nil {
		return err
	}
	m := p.(*spacesyncproto.ObjectSyncMessage)
	c.e.bg.Add(1)
	go func() {
		defer c.e.bg.Done()
		// Incoming RPC contexts end when their handler returns. Broadcasts
		// are queued work, so preserve values with an independent deadline.
		broadcastCtx, cancel := context.WithTimeout(context.WithoutCancel(ct), 30*time.Second)
		defer cancel()
		must(c.e.remote.DoDrpc(broadcastCtx, func(conn drpc.Conn) error {
			_, err := spacesyncproto.NewDRPCSpaceSyncClient(conn).ObjectSync(broadcastCtx, m)
			return err
		}))
	}()
	return nil
}
func (c *client) QueueRequest(ct context.Context, rq syncdeps.Request) error {
	t := c.e.get(rq.ObjectId())
	if t == nil {
		return errors.New("unknown tree")
	}
	return c.SendTreeRequest(ct, rq, t.ResponseCollector())
}
func (e *endpoint) deps() synctree.BuildDeps {
	return synctree.BuildDeps{SpaceId: e.storage.Id(), SyncClient: e.client, AclList: e.acl, SpaceStorage: e.storage, BuildObjectTree: objecttree.BuildObjectTree, SyncStatus: &status{}, OnClose: func(string) {}}
}
func newEndpoint(path string, keys *accountdata.AccountKeys, payload spacestorage.SpaceStorageCreatePayload, create bool) *endpoint {
	must(os.MkdirAll(path, 0700))
	db, err := anystore.Open(ctx, filepath.Join(path, "store.db"), nil)
	must(err)
	var st spacestorage.SpaceStorage
	if create {
		st, err = spacestorage.Create(ctx, db, payload)
	} else {
		st, err = spacestorage.New(ctx, payload.SpaceHeaderWithId.Id, db)
	}
	must(err)
	ast, err := st.AclStorage()
	must(err)
	// Official LocalOnly-mode verifier validates full author signatures/ACL
	// transitions, rather than relying on consensus-node acceptor signatures.
	acl, err := list.BuildAclListWithIdentity(keys, ast, recordverifier.NewValidateFull())
	must(err)
	e := &endpoint{keys: keys, db: db, storage: st, acl: acl, trees: map[string]synctree.SyncTree{}, incoming: make(chan peer.Peer, 1)}
	e.client = &client{RequestFactory: synctree.NewRequestFactory(st.Id()), e: e}
	return e
}
func (e *endpoint) network() {
	e.app = &app.App{}
	e.rpc = server.New()
	e.yam = yamux.New()
	e.yam.SetAccepter(accepter{e})
	e.app.Register(&config{}).Register(&account{e.keys}).Register(&localNodes{}).Register(secureservice.New()).Register(e.rpc).Register(e.yam)
	must(e.app.Start(ctx))
	must(spacesyncproto.DRPCRegisterSpaceSync(e.rpc, e))
}
func connect(a, b *endpoint) float64 {
	start := time.Now()
	a.network()
	b.network()
	lis, err := net.Listen("tcp", "127.0.0.1:0")
	must(err)
	a.yam.AddListener(lis)
	ct, cancel := context.WithTimeout(secureservice.CtxAllowAccountCheck(ctx), 20*time.Second)
	defer cancel()
	mc, err := b.yam.Dial(ct, lis.Addr().String())
	must(err)
	b.mc = mc
	b.remote, err = peer.NewPeer(mc, b.rpc)
	must(err)
	select {
	case a.remote = <-a.incoming:
	case <-ct.Done():
		panic(ct.Err())
	}
	// Reuse an authenticated RPC connection in both directions before timing.
	for _, e := range []*endpoint{a, b} {
		must(e.remote.DoDrpc(ct, func(c drpc.Conn) error {
			_, err := spacesyncproto.NewDRPCSpaceSyncClient(c).ObjectSync(ct, &spacesyncproto.ObjectSyncMessage{ObjectId: "benchmark-handshake"})
			return err
		}))
	}
	return ms(start)
}
func (e *endpoint) stopNetwork() {
	e.bg.Wait()
	if e.remote != nil {
		_ = e.remote.Close()
	}
	if e.app != nil {
		must(e.app.Close(ctx))
	}
}
func (e *endpoint) closeDB() { must(e.db.Flush(ctx, 0, anystore.FlushModeFsync)); must(e.db.Close()) }
func add(t synctree.SyncTree, keys *accountdata.AccountKeys, op Op) {
	t.Lock()
	defer t.Unlock()
	_, err := t.AddContent(ctx, objecttree.SignableChangeContent{Data: enc(op), Key: keys.SignKey, ShouldBeEncrypted: true, DataType: "syncbench-json-v1"})
	must(err)
}
func prepare(e *endpoint, gs []*Group) {
	for _, g := range gs {
		root, err := objecttree.CreateObjectTreeRoot(objecttree.ObjectTreeCreatePayload{PrivKey: e.keys.SignKey, SpaceId: e.storage.Id(), ChangeType: "syncbench-json-v1", IsEncrypted: true, Seed: []byte(g.Name)}, e.acl)
		must(err)
		t, err := synctree.PutSyncTree(ctx, treestorage.TreeStorageCreatePayload{RootRawChange: root}, e.deps())
		must(err)
		e.put(t)
		g.TreeID = t.Id()
		for _, op := range g.Ops {
			add(t, e.keys, op)
		}
	}
	must(e.db.Flush(ctx, 0, anystore.FlushModeFsync))
}
func reconstruct(e *endpoint, gs []*Group) []byte {
	f := Fixture{"issues": make([]map[string]any, 21), "notes": make([]map[string]any, 111)}
	for _, g := range gs {
		t := e.get(g.TreeID)
		if t == nil {
			panic("missing tree")
		}
		t.Lock()
		err := t.IterateRoot(func(ch *objecttree.Change, b []byte) (any, error) {
			if ch.DataType != "syncbench-json-v1" {
				return nil, nil
			}
			var op Op
			err := json.Unmarshal(b, &op)
			return op, err
		}, func(ch *objecttree.Change) bool {
			op, ok := ch.Model.(Op)
			if !ok {
				return true
			}
			if op.Index == nil {
				var records []map[string]any
				must(json.Unmarshal(op.Value, &records))
				f[op.Collection] = records
			} else {
				var r map[string]any
				must(json.Unmarshal(op.Value, &r))
				f[op.Collection][*op.Index] = r
			}
			return true
		})
		t.Unlock()
		must(err)
	}
	return enc(f)
}

type Disk struct {
	Apparent  int64 `json:"apparent_bytes"`
	Allocated int64 `json:"allocated_bytes"`
	Files     int   `json:"files"`
}

func disk(path string) Disk {
	var d Disk
	must(filepath.WalkDir(path, func(p string, x fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if x.IsDir() {
			return nil
		}
		s, err := x.Info()
		if err != nil {
			return err
		}
		d.Apparent += s.Size()
		d.Allocated += s.Sys().(*syscall.Stat_t).Blocks * 512
		d.Files++
		return nil
	}))
	return d
}
func netDisk(a, b Disk) Disk {
	return Disk{Apparent: b.Apparent - a.Apparent, Allocated: b.Allocated - a.Allocated, Files: b.Files - a.Files}
}

type Update struct {
	Field          string  `json:"field"`
	SourceOldBytes int     `json:"source_old_value_bytes"`
	SourceNewBytes int     `json:"source_new_value_bytes"`
	OperationBytes int     `json:"operation_bytes"`
	ObservableMS   float64 `json:"observable_ms"`
	FsyncMS        float64 `json:"fsync_completion_ms"`
	Received       int64   `json:"received_protobuf_bytes"`
	Transport      int64   `json:"received_transport_bytes"`
	Hash           string  `json:"sha256"`
}
type Result struct {
	UTC             string           `json:"utc_started"`
	StorePath       string           `json:"store_path"`
	SecurityChecks  []string         `json:"security_checks"`
	Model           string           `json:"model"`
	Run             int              `json:"run"`
	Warmup          bool             `json:"warmup"`
	Trees           int              `json:"trees"`
	PrepareMS       float64          `json:"sender_prepare_ms"`
	ConnectMS       float64          `json:"connection_auth_and_network_setup_ms"`
	ReceiverSetupMS float64          `json:"receiver_prepare_ms"`
	ObservableMS    float64          `json:"observable_ms"`
	FsyncMS         float64          `json:"fsync_completion_ms"`
	Received        int64            `json:"received_protobuf_bytes"`
	Transport       int64            `json:"received_transport_bytes"`
	Baseline        Disk             `json:"receiver_baseline"`
	Total           Disk             `json:"receiver_total"`
	Net             Disk             `json:"receiver_net"`
	Sender          Disk             `json:"sender_total"`
	SenderInitial   Disk             `json:"sender_initial_total"`
	ReceiverStats   anystore.DBStats `json:"receiver_database_stats"`
	AfterUpdates    Disk             `json:"receiver_after_updates"`
	ServiceDisk     int64            `json:"required_service_storage_bytes"`
	InitialHash     string           `json:"initial_reopen_sha256"`
	FinalHash       string           `json:"updated_reopen_sha256"`
	Updates         []Update         `json:"updates"`
}

func loadLocal(e *endpoint, gs []*Group) {
	for _, g := range gs {
		t, err := synctree.BuildSyncTreeOrGetRemote(ctx, g.TreeID, e.deps())
		must(err)
		e.put(t)
	}
}
func checkSecurity(e *endpoint, gs []*Group) {
	for _, g := range gs {
		t := e.get(g.TreeID)
		ch, err := t.GetChange(t.Heads()[0])
		must(err)
		if ch.ReadKeyId == "" || !ch.Identity.Equals(e.keys.SignKey.GetPublic()) {
			panic("payload encryption/signing assertion failed")
		}
	}
	t := e.get(gs[0].TreeID)
	stored, err := t.Storage().Get(ctx, t.Heads()[0])
	must(err)
	raw := &treechangeproto.RawTreeChange{}
	must(raw.UnmarshalVT(stored.RawChange))
	raw.Signature[0] ^= 1
	b, err := raw.MarshalVT()
	must(err)
	builder := objecttree.NewChangeBuilder(crypto.NewKeyStorage(), t.Header())
	_, err = builder.Unmarshall(&treechangeproto.RawTreeChangeWithId{Id: stored.Id, RawChange: b}, true)
	if !errors.Is(err, objecttree.ErrIncorrectCid) {
		panic("tampered CID accepted")
	}
	id, err := cidutil.NewCidFromBytes(b)
	must(err)
	_, err = builder.Unmarshall(&treechangeproto.RawTreeChangeWithId{Id: id, RawChange: b}, true)
	if !errors.Is(err, objecttree.ErrIncorrectSignature) {
		panic("tampered signature accepted")
	}
	outsider, err := accountdata.NewRandom()
	must(err)
	identity, err := outsider.SignKey.GetPublic().Marshall()
	must(err)
	if e.authorize(peer.CtxWithIdentity(ctx, identity)) == nil {
		panic("unrelated identity authorized")
	}
}
func run(root string, blob []byte, model string, n int, warm bool) Result {
	utc := time.Now().UTC().Format(time.RFC3339Nano)
	var f Fixture
	must(json.Unmarshal(blob, &f))
	gs := groups(f, model)
	keys, err := accountdata.NewRandom()
	must(err)
	other, err := accountdata.NewRandom()
	must(err)
	other.SignKey = keys.SignKey
	master, _, err := crypto.GenerateRandomEd25519KeyPair()
	must(err)
	meta, _, err := crypto.GenerateRandomEd25519KeyPair()
	must(err)
	payload, err := spacepayloads.StoragePayloadForSpaceCreate(spacepayloads.SpaceCreatePayload{SigningKey: keys.SignKey, SpaceType: "syncbench", ReplicationKey: 10, MasterKey: master, MetadataKey: meta, ReadKey: crypto.NewAES(), Metadata: []byte("synthetic benchmark")})
	must(err)
	base := filepath.Join(root, fmt.Sprintf("%s-%02d-%t", model, n, warm))
	if _, err := os.Stat(base); err == nil {
		panic("refusing to reuse receiver")
	}
	must(os.MkdirAll(base, 0700))
	sp := filepath.Join(base, "sender")
	rp := filepath.Join(base, "receiver")
	start := time.Now()
	sender := newEndpoint(sp, keys, payload, true)
	prepare(sender, gs)
	checkSecurity(sender, gs)
	sender.closeDB()
	senderInitial := disk(sp)
	sender = newEndpoint(sp, keys, payload, false)
	loadLocal(sender, gs)
	prep := ms(start)
	start = time.Now()
	receiver := newEndpoint(rp, other, payload, true)
	receiver.closeDB()
	baseline := disk(rp)
	receiver = newEndpoint(rp, other, payload, false)
	rprep := ms(start)
	conn := connect(sender, receiver)
	protoBefore := receiver.received.Load()
	transportBefore := receiver.mc.BytesRead()
	start = time.Now()
	for _, g := range gs {
		ct := peer.CtxWithPeerId(ctx, sender.keys.PeerId)
		t, err := synctree.BuildSyncTreeOrGetRemote(ct, g.TreeID, receiver.deps())
		must(err)
		receiver.put(t)
	}
	got := reconstruct(receiver, gs)
	if !bytes.Equal(got, blob) {
		panic("initial roundtrip mismatch")
	}
	obs := ms(start)
	receiver.bg.Wait()
	sender.bg.Wait()
	must(receiver.db.Flush(ctx, 0, anystore.FlushModeFsync))
	dur := ms(start)
	r := Result{Model: model, Run: n, Warmup: warm, Trees: len(gs), PrepareMS: prep, ReceiverSetupMS: rprep, ConnectMS: conn, ObservableMS: obs, FsyncMS: dur, Received: receiver.received.Load() - protoBefore, Transport: receiver.mc.BytesRead() - transportBefore, Baseline: baseline}
	r.UTC = utc
	r.StorePath = base
	r.SecurityChecks = []string{"all_payload_heads_encrypted_and_signed", "tampered_cid_rejected", "tampered_signature_rejected", "unrelated_acl_identity_rejected"}
	r.SenderInitial = senderInitial
	r.ReceiverStats, err = receiver.db.Stats(ctx)
	must(err)
	receiver.stopNetwork()
	sender.stopNetwork()
	receiver.closeDB()
	r.Total = disk(rp)
	r.Net = netDisk(baseline, r.Total)
	receiver = newEndpoint(rp, other, payload, false)
	loadLocal(receiver, gs)
	got = reconstruct(receiver, gs)
	if !bytes.Equal(got, blob) {
		panic("initial reopen mismatch")
	}
	r.InitialHash = hash(got)
	connect(sender, receiver)
	for _, change := range []struct{ c, k, v string }{{"issues", "title", "Synthetic issue title updated"}, {"notes", "body", "Synthetic note body updated"}} {
		old := enc(f[change.c][0][change.k])
		f[change.c][0][change.k] = change.v
		expected := enc(f)
		var g *Group
		for _, x := range gs {
			if (model == "record_trees" && x.Name == f[change.c][0]["id"]) || (model != "record_trees" && x.Name == change.c) {
				g = x
				break
			}
		}
		zero := 0
		op := Op{Collection: change.c, Index: &zero, Value: enc(f[change.c][0])}
		if model == "opaque_collections" {
			op.Index = nil
			op.Value = enc(f[change.c])
		}
		before := receiver.received.Load()
		tb := receiver.mc.BytesRead()
		start = time.Now()
		add(sender.get(g.TreeID), keys, op)
		sender.bg.Wait()
		receiver.bg.Wait()
		got = reconstruct(receiver, gs)
		if !bytes.Equal(got, expected) {
			panic("incremental mismatch")
		}
		o := ms(start)
		must(receiver.db.Flush(ctx, 0, anystore.FlushModeFsync))
		r.Updates = append(r.Updates, Update{Field: change.c + ".0." + change.k, SourceOldBytes: len(old), SourceNewBytes: len(enc(change.v)), OperationBytes: len(enc(op)), ObservableMS: o, FsyncMS: ms(start), Received: receiver.received.Load() - before, Transport: receiver.mc.BytesRead() - tb, Hash: hash(got)})
	}
	receiver.stopNetwork()
	sender.stopNetwork()
	receiver.closeDB()
	sender.closeDB()
	r.AfterUpdates = disk(rp)
	r.Sender = disk(sp)
	receiver = newEndpoint(rp, other, payload, false)
	loadLocal(receiver, gs)
	got = reconstruct(receiver, gs)
	if !bytes.Equal(got, enc(f)) {
		panic("updated reopen mismatch")
	}
	r.FinalHash = hash(got)
	receiver.closeDB()
	return r
}
func main() {
	logger.SetDefault(zap.NewNop())
	logger.SetNamedLevels(nil)
	fixture := flag.String("fixture", "outputs/fixture/fixture.json", "synthetic fixture")
	root := flag.String("stores", "work/stores", "fresh task-owned stores")
	out := flag.String("out", "outputs/results.jsonl", "raw output")
	warm := flag.Int("warmups", 3, "warmups per model")
	count := flag.Int("runs", 10, "measured per model")
	model := flag.String("model", "all", "model or all")
	flag.Parse()
	blob, err := os.ReadFile(*fixture)
	must(err)
	if hash(blob) != "9b8f0b8e52345b95d0bd3434d125ef2dc1a688ad537c0c3a1ccc8348981a101a" {
		panic("manifest mismatch")
	}
	models := []string{"record_trees", "collection_blocks", "opaque_collections"}
	if *model != "all" {
		models = []string{*model}
	}
	must(os.MkdirAll(*root, 0700))
	file, err := os.OpenFile(*out, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	must(err)
	defer file.Close()
	for _, m := range models {
		if m != "record_trees" && m != "collection_blocks" && m != "opaque_collections" {
			panic("invalid model")
		}
		for i := -*warm; i < *count; i++ {
			r := run(*root, blob, m, i, i < 0)
			_, err = file.Write(append(enc(r), '\n'))
			must(err)
			must(file.Sync())
			fmt.Printf("%s run=%d warmup=%t readable=%.3f ms fsync=%.3f ms bytes=%d\n", m, i, i < 0, r.ObservableMS, r.FsyncMS, r.Received)
		}
	}
}
