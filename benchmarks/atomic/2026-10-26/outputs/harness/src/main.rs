mod model;
use atomic_lib::{
    agents::{Agent, ForAgent},
    db::{compaction::CompactionPolicy, trees::Tree},
    envelopes,
    storelike::Query,
    sync::{engine, protocol},
    urls, Db, Storelike, Subject, Value,
};
use futures::{SinkExt, StreamExt};
use serde_json::{json, Value as Json};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    path::Path,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::net::TcpListener;
use tokio_tungstenite::{
    accept_async_with_config, connect_async_with_config,
    tungstenite::{protocol::WebSocketConfig, Message},
};
type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
fn ms(t: Instant) -> f64 {
    t.elapsed().as_secs_f64() * 1000.
}
fn wire_config() -> WebSocketConfig {
    WebSocketConfig::default()
        .max_message_size(Some(64 * 1024 * 1024))
        .max_frame_size(Some(64 * 1024 * 1024))
}
fn pure(s: &str) -> String {
    Subject::from_raw(s, None).pure_id()
}
async fn open(path: &Path) -> Result<Db> {
    Ok(Db::init_redb_file_with_policy(
        path,
        None,
        &path.join("uploads"),
        &CompactionPolicy::disabled(),
    )
    .await?)
}
async fn binary<S>(socket: &mut tokio_tungstenite::WebSocketStream<S>) -> Result<Vec<u8>>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    loop {
        match tokio::time::timeout(Duration::from_secs(180), socket.next())
            .await?
            .ok_or("Socket closed")??
        {
            Message::Binary(bytes) => return Ok(bytes.to_vec()),
            Message::Ping(bytes) => socket.send(Message::Pong(bytes)).await?,
            Message::Close(_) => return Err("Peer closed connection".into()),
            _ => {}
        }
    }
}
fn checked(frame: &[u8]) -> Result<()> {
    if frame.first() == Some(&protocol::tag::ERROR) {
        let error = protocol::decode_error(&frame[1..]).ok_or("Malformed ERROR")?;
        return Err(format!("Peer refused frame with error code {}", error.code).into());
    }
    Ok(())
}
async fn summary(db: &Db, drive: &str) -> Result<Json> {
    let subjects = engine::collect_drive_subjects(db, &drive.into()).await;
    let mut ordered: Vec<_> = subjects.iter().collect();
    ordered.sort();
    let mut hash = Sha256::new();
    let mut crdt_state_hash = Sha256::new();
    let mut search_hash = Sha256::new();
    let mut search_ids = HashSet::new();
    let mut tables = BTreeMap::<String, Vec<String>>::new();
    let mut envelope_signatures = BTreeMap::<String, Vec<String>>::new();
    for subject in ordered {
        let resource = db.get_resource(&subject.as_str().into()).await?;
        let mut value: Json = serde_json::from_str(&resource.to_json_ad(None)?)?;
        // Loro may encode an equivalent imported snapshot with different
        // bytes. Compare its full deep state and causal hash independently,
        // rather than treating its base64 transport representation as data.
        value
            .as_object_mut()
            .ok_or("Resource is not an object")?
            .remove(urls::LORO_UPDATE);
        let snapshot = db
            .kv
            .get(Tree::LoroSnapshots, subject.as_bytes())?
            .ok_or("Missing snapshot")?;
        let doc = atomic_lib::loro::AtomicLoroDoc::from_snapshot(&snapshot)?;
        let state = serde_jcs::to_vec(&serde_json::to_value(doc.doc().get_deep_value())?)?;
        crdt_state_hash.update((state.len() as u64).to_be_bytes());
        crdt_state_hash.update(state);
        let canonical = serde_jcs::to_vec(&value)?;
        hash.update((canonical.len() as u64).to_be_bytes());
        hash.update(canonical);
        let digest = blake3::hash(subject.as_bytes());
        search_ids.insert(digest.as_bytes()[..8].to_vec());
        let search_doc = db
            .kv
            .get(Tree::SearchDocs, &digest.as_bytes()[..8])?
            .unwrap_or_default();
        search_hash.update(subject.as_bytes());
        search_hash.update((search_doc.len() as u64).to_be_bytes());
        search_hash.update(search_doc);
        let mut signatures: Vec<_> = envelopes::envelopes(db, subject)
            .into_iter()
            .map(|e| e.signature)
            .collect();
        signatures.sort();
        envelope_signatures.insert(subject.clone(), signatures);
        if resource.has_class(urls::TABLE) {
            let class = resource.get(urls::CLASSTYPE_PROP)?.to_string();
            let mut query = Query::new_class(&class)
                .filter(urls::PARENT, Value::AtomicUrl(subject.as_str().into()));
            query.drive = Some(drive.into());
            query.include_nested = false;
            let result = db.query(&query).await?;
            let mut rows: Vec<_> = result.subjects.iter().map(|s| s.pure_id()).collect();
            rows.sort();
            tables.insert(subject.clone(), rows);
        }
    }
    // Postings carry their document id as the final eight bytes. Compare the
    // drive's complete posting set, not just its stored document metadata.
    let mut postings_hash = Sha256::new();
    for pair in db.kv.iter_tree(Tree::SearchPostings) {
        let (key, value) = pair?;
        if key.len() >= 8 && search_ids.contains(&key[key.len() - 8..]) {
            postings_hash.update((key.len() as u64).to_be_bytes());
            postings_hash.update(key);
            postings_hash.update((value.len() as u64).to_be_bytes());
            postings_hash.update(value);
        }
    }
    let vvs = engine::build_drive_vvs(db, &subjects);
    Ok(
        json!({"resources":subjects.len(), "rows":tables.values().map(Vec::len).sum::<usize>(),
        "tables":tables, "propertiesSha256":hex::encode(hash.finalize()),
        "searchDocsSha256":hex::encode(search_hash.finalize()),
        "searchPostingsSha256":hex::encode(postings_hash.finalize()),
        "crdtStateSha256":hex::encode(crdt_state_hash.finalize()),
        "crdtHash":engine::compute_drive_hash_v2(&vvs), "envelopes":envelope_signatures}),
    )
}
fn comparable(summary: &Json) -> Json {
    json!({"resources":summary["resources"], "rows":summary["rows"], "tables":summary["tables"],
        "propertiesSha256":summary["propertiesSha256"], "searchDocsSha256":summary["searchDocsSha256"],
        "searchPostingsSha256":summary["searchPostingsSha256"],
        "crdtStateSha256":summary["crdtStateSha256"],
        "crdtHash":summary["crdtHash"], "envelopes":summary["envelopes"]})
}
#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() -> Result<()> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() < 2 { return Err("Usage: FIXTURE_JSON NEW_RUN_DIRECTORY [RUNS=13]".into()); }
    let fixture: Json = serde_json::from_slice(&fs::read(&args[0])?)?;
    let output = Path::new(&args[1]);
    fs::create_dir(output)?;
    let runs: usize = args.get(2).map(|v|v.parse()).transpose()?.unwrap_or(13);
    let preparing = Instant::now();
    let source = open(&output.join("source")).await?;
    let config = model::prepare(&source,&fixture,output).await?;
    let drive = config["drive"].as_str().unwrap().to_owned();
    let owner = Agent::new_from_public_key(config["ownerPublicKey"].as_str().unwrap())?;
    let reader = Agent::from_secret(fs::read_to_string(output.join("temporary-owner.secret"))?.trim())?;
    let edit_source = source.clone();
    if model::reconstruct(&source,&config,&fixture).await? != fixture {return Err("Prepared source fixture differs".into());}
    let root = source.get_resource(&drive.as_str().into()).await?;
    atomic_lib::hierarchy::check_read(&source, &root, &ForAgent::from(reader.subject.clone()))
        .await?;
    let expected = summary(&source, &drive).await?;
    if expected["rows"] != 132 {
        return Err("Source is not the complete 132-row dataset".into());
    }
    // The sender may fully prepare before the timer: cache the real engine's
    // complete binary response, including every retained signed envelope.
    let frames = engine::handle_sync_vv_reconcile(
        &drive,
        "",
        2,
        HashMap::new,
        None,
        &source,
        &ForAgent::from(reader.subject.clone()),
        engine::WireScheme::CANONICAL,
        false,
    )
    .await;
    let mut entries = 0;
    let mut signed_envelopes = 0;
    let mut wire_bytes = 0;
    let mut delivered = HashSet::new();
    for frame in &frames {
        checked(frame)?;
        wire_bytes += frame.len();
        if frame.first() == Some(&protocol::tag::SYNC_PUSH) {
            let push =
                protocol::decode_sync_push(&frame[1..]).ok_or("Invalid prepared SYNC_PUSH")?;
            entries += push.entries.len();
            signed_envelopes += push.envelopes.len();
            for entry in push.entries {
                delivered.insert(pure(&entry.subject));
            }
        }
    }
    if delivered.len() as u64 != expected["resources"].as_u64().unwrap() {
        return Err("Source response omits drive resources".into());
    }
    // Canonical response preparation must include all expected envelopes. No
    // validity checks, history, values or index work are dropped for timing.
    let messages: Arc<Vec<Message>> = Arc::new(
        frames
            .into_iter()
            .map(|f| Message::Binary(f.into()))
            .collect(),
    );
    source.flush()?;
    fs::write(output.join("source-logical-storage.json"),serde_json::to_vec_pretty(&logical_storage(&source)?)?)?;
    let source_disk = disk(&output.join("source"))?;
    let source_preparation_ms = ms(preparing);
    println!(
        "{}",
        json!({"stage":"source-ready", "resources":entries, "rows":132,
        "wireBytes":wire_bytes, "signedEnvelopes":signed_envelopes, "preparationMs":source_preparation_ms})
    );
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let origin = format!("http://{}", listener.local_addr()?);
    let url = format!("ws://{}/ws", listener.local_addr()?);
    let server_drive = drive.clone();
    let server_origin = origin.clone();
    let reader_id = reader.subject.pure_id();
    let server = tokio::spawn(async move {
        for server_run in 1..=runs {
            let (stream, _) = listener.accept().await?;
            stream.set_nodelay(true)?;
            let mut socket = accept_async_with_config(stream, Some(wire_config())).await?;
            let nonce = Agent::new(None)?.public_key;
            socket
                .send(Message::Binary(protocol::encode_challenge(&nonce).into()))
                .await?;
            let auth = binary(&mut socket).await?;
            if auth.first() != Some(&protocol::tag::AUTH) {
                return Err("Expected AUTH".into());
            }
            let mut agent = ForAgent::Public;
            let answers = engine::handle_auth_frame(
                &auth[1..],
                &source,
                &mut agent,
                engine::AuthBinding::Origin(&server_origin),
                engine::AuthChallenge::Required(&nonce),
            )
            .await;
            for answer in &answers {
                checked(answer)?;
            }
            if !matches!(&agent, ForAgent::AgentSubject(s) if s.pure_id() == reader_id) {
                return Err("Unexpected authenticated reader".into());
            }
            let root = source.get_resource(&server_drive.as_str().into()).await?;
            atomic_lib::hierarchy::check_read(&source, &root, &agent).await?;
            socket
                .send(Message::Binary(
                    protocol::encode_auth_ok_with_caps(&[
                        "auth-nonce",
                        "sparse-sync",
                        "canonical-scheme",
                    ])
                    .into(),
                ))
                .await?;
            loop {
                let frame = binary(&mut socket).await?;
                if frame.first() == Some(&protocol::tag::HELLO) {
                    continue;
                }
                if frame.first() != Some(&protocol::tag::SYNC) {
                    return Err("Expected initial SYNC".into());
                }
                let sync = protocol::decode_sync(&frame[1..]).ok_or("Malformed initial SYNC")?;
                if pure(&sync.drive) != pure(&server_drive) || !sync.drive_hash.is_empty() {
                    return Err("Benchmark requires empty-state whole-drive SYNC".into());
                }
                break;
            }
            for frame in messages.iter() {
                socket.send(frame.clone()).await?;
            }
            if server_run == runs {
                let sub = binary(&mut socket).await?;
                let out = engine::handle_frame_full(&sub,&source,&mut agent).await;
                if out.subscribe.is_none() {return Err("Native SUB rejected".into());}
                let mut events=source.subscribe_events();
                socket.send(Message::Binary(protocol::encode_sync_ok(&server_drive).into())).await?;
                let mut sent=0;
                while sent<2 {
                    if let atomic_lib::DbEvent::Changed{subject,delta:Some(delta),..}=events.recv().await? {
                        let resource=source.get_resource(&subject).await?;
                        atomic_lib::hierarchy::check_read(&source,&resource,&agent).await?;
                        socket.send(Message::Binary(protocol::encode_update(0,0,&subject.pure_id(),None,&delta).into())).await?;
                        sent+=1;
                    }
                }
                // Keep the loopback session open until the receiver acknowledges it is done.
                let _=socket.next().await;
            }
            let _ = socket.close(None).await;
        }
        Ok::<_, Box<dyn std::error::Error + Send + Sync>>(())
    });
    let mut results = Vec::new();
    for run in 1..=runs {
        let directory = output.join(format!("replica-{run}"));
        let startup = Instant::now();
        let db = open(&directory).await?;
        db.add_resource(&owner.to_resource()?).await?;
        // Register empty native table queries before timing so replication maintains their indexes.
        for collection in ["issues","notes"] {
            let class=config["classes"][collection].as_str().unwrap();
            let table=config["tables"][collection].as_str().unwrap();
            let mut q=Query::new_class(class).filter(urls::PARENT,Value::AtomicUrl(table.into()));
            q.drive=Some(drive.as_str().into());q.include_nested=false;
            if !db.query(&q).await?.subjects.is_empty() {return Err("Fresh table unexpectedly has rows".into());}
        }
        // Startup/builtin model population and agent setup are outside timing.
        db.flush()?;
        if db.has_resource_locally(&drive) {
            return Err("Receiver already holds the drive".into());
        }
        drop(db);
        let baseline_disk=disk(&directory)?;
        let db=open(&directory).await?;
        let startup_ms = ms(startup);
        if run==1 {fs::write(output.join("receiver-baseline-logical-storage.json"),serde_json::to_vec_pretty(&logical_storage(&db)?)?)?;}
        let transport = Instant::now();
        let (mut socket, _) = connect_async_with_config(&url, Some(wire_config()), true).await?;
        let frame = binary(&mut socket).await?;
        let nonce = protocol::decode_challenge(&frame[1..]).ok_or("Missing CHALLENGE")?;
        socket
            .send(Message::Binary(
                protocol::encode_auth(&reader, &format!("{origin}#{nonce}"))?.into(),
            ))
            .await?;
        let auth = binary(&mut socket).await?;
        checked(&auth)?;
        if auth.first() != Some(&protocol::tag::AUTH_OK) {
            return Err("Missing AUTH_OK".into());
        }
        socket
            .send(Message::Binary(
                protocol::encode_hello_with_caps(
                    "syncd-bulk-benchmark",
                    &["canonical-scheme", "sparse-sync"],
                )
                .into(),
            ))
            .await?;
        let connection_auth_ms = ms(transport);
        let syncing = Instant::now();
        socket
            .send(Message::Binary(
                protocol::encode_sync_sparse(&drive, "", &HashMap::new()).into(),
            ))
            .await?;
        let (mut imported, mut bytes, mut chunks, mut received_envelopes) = (0, 0, 0, 0);
        let (mut socket_wait_ms, mut import_ms) = (0., 0.);
        let final_chunk_ms = loop {
            let waiting = Instant::now();
            let frame = binary(&mut socket).await?;
            socket_wait_ms += ms(waiting);
            bytes += frame.len();
            checked(&frame)?;
            match frame[0] {
                protocol::tag::SYNC_DIFF => {
                    let diff =
                        protocol::decode_sync_diff(&frame[1..]).ok_or("Malformed SYNC_DIFF")?;
                    if !diff.pull.is_empty() || !diff.remove.is_empty() {
                        return Err("Fresh receiver has an unexpected diff".into());
                    }
                }
                protocol::tag::SYNC_PUSH => {
                    let push =
                        protocol::decode_sync_push(&frame[1..]).ok_or("Malformed SYNC_PUSH")?;
                    if pure(&push.drive) != pure(&drive) {
                        return Err("Wrong drive".into());
                    }
                    chunks += 1;
                    received_envelopes += push.envelopes.len();
                    let importing = Instant::now();
                    let (count, blobs) = engine::import_sync_push(
                        &push,
                        &db,
                        &ForAgent::from(owner.subject.clone()),
                        false,
                    )
                    .await
                    .map_err(|e| format!("Import refused: {e:?}"))?;
                    let elapsed = ms(importing);
                    import_ms += elapsed;
                    imported += count;
                    if count != push.entries.len() || !blobs.is_empty() {
                        return Err("Incomplete resource/blob import".into());
                    }
                    if push.last {
                        break elapsed;
                    }
                }
                protocol::tag::SYNC_OK => {
                    return Err("Empty receiver unexpectedly already in sync".into())
                }
                _ => return Err("Unexpected frame".into()),
            }
        };
        // Native import includes LAST's durability barrier; no earlier readable callback exists.
        // LAST import returns only after its propagated durability barrier.
        // Do not call an extra flush or stop the timer before that returns.
        let sync_ms = ms(syncing);
        let total_ms = ms(transport);
        println!(
            "{}",
            json!({"stage":"transfer-complete", "run":run,
            "transportAndPersistenceMs":total_ms, "syncRequestToDurableMs":sync_ms,
            "socketWaitMs":socket_wait_ms, "importMs":import_ms, "imported":imported})
        );
        if run != runs { let _ = socket.close(None).await; }
        if imported != entries || received_envelopes != signed_envelopes {
            return Err("Transfer omitted resources or signatures".into());
        }
        let verifying = Instant::now();
        if model::reconstruct(&db,&config,&fixture).await? != fixture { return Err("Live complete fixture differs".into()); }
        let readable_confirmed_ms=ms(syncing);
        let got = summary(&db, &drive).await?;
        if comparable(&got) != comparable(&expected) {
            fs::write(
                output.join("expected.json"),
                serde_json::to_vec_pretty(&expected)?,
            )?;
            fs::write(output.join("actual.json"), serde_json::to_vec_pretty(&got)?)?;
            return Err("Live resource/index/CRDT/envelope verification differs".into());
        }
        drop(db);
        let reopened = open(&directory).await?;
        let reopened_summary = summary(&reopened, &drive).await?;
        if comparable(&reopened_summary) != comparable(&expected) {
            return Err("Reopened resource/index/CRDT/envelope verification differs".into());
        }
        if model::reconstruct(&reopened,&config,&fixture).await? != fixture {return Err("Reopened fixture differs".into());}
        drop(reopened);
        let receiver_disk=disk(&directory)?;
        if run==1 {let snapshot_db=open(&directory).await?;fs::write(output.join("receiver-initial-logical-storage.json"),serde_json::to_vec_pretty(&logical_storage(&snapshot_db)?)?)?;drop(snapshot_db);}
        fs::write(output.join(format!("verification-{run}.json")),serde_json::to_vec_pretty(&json!({"expected":expected,"actual":reopened_summary,"fixtureSha256":hex::encode(Sha256::digest(serde_jcs::to_vec(&fixture)?)),"completeFixtureEqual":true}))?)?;
        let result = json!({"run":run, "startupMsExcluded":startup_ms, "connectionAuthMs":connection_auth_ms,
            "syncRequestToDurableMs":sync_ms, "transportAndPersistenceMs":total_ms,
            "socketWaitMs":socket_wait_ms, "importMs":import_ms, "lastChunkIncludingFlushMs":final_chunk_ms,
            "wireBytes":bytes, "chunks":chunks, "imported":imported, "signedEnvelopes":received_envelopes,
            "rows":132, "verifiedAfterReopen":true, "verificationMsExcluded":ms(verifying), "targetMs":100,
            "targetMet":sync_ms<=100.,"warmup":run<=3,
            "readableConfirmedMs":readable_confirmed_ms,"earlierReadableMs":Json::Null,
            "receiverBaselineDisk":baseline_disk,"receiverTotalDisk":receiver_disk,
            "receiverNetDisk":{"apparentBytes":receiver_disk["apparentBytes"].as_u64().unwrap()-baseline_disk["apparentBytes"].as_u64().unwrap(),"allocatedBytes":receiver_disk["allocatedBytes"].as_u64().unwrap()-baseline_disk["allocatedBytes"].as_u64().unwrap()}});
        println!("{result}");
        results.push(result);
        fs::write(
            output.join("results.json"),
            serde_json::to_vec_pretty(&json!({
                "sourcePreparationMsExcluded":source_preparation_ms, "preparedSender":true,
                "databaseStartupExcluded":true, "transport":"binary Atomic over loopback WebSocket",
                "receiverPrincipal":"pre-established source owner; reader authenticated over WebSocket",
                "runs":results,"sourceDisk":source_disk,"model":"H","sourceSummary":expected,
                "readableBoundary":"No API callback before native LAST flush; readableConfirmedMs includes full reconstruction after durable return; earlierReadableMs unobservable",
            }))?,
        )?;
        if run==runs {
            let receiver=open(&directory).await?;
            socket.send(Message::Binary(protocol::encode_sub(&drive).into())).await?;
            let ready=binary(&mut socket).await?;
            if ready[0]!=protocol::tag::SYNC_OK {return Err("Subscription setup failed".into());}
            let mut changed=fixture.clone();
            let mut increments=Vec::new();
            for (collection,field,new_value) in [("issues","title",json!("Synthetic changed issue title")),("notes","body",json!(format!("{} Synthetic incremental edit.",fixture["notes"][0]["body"].as_str().unwrap())))] {
                let id=fixture[collection][0]["id"].as_str().unwrap();
                let subject=config["records"][id].as_str().unwrap();
                let property=config["properties"][field].as_str().unwrap();
                let mut resource=edit_source.get_resource(&subject.into()).await?;
                let native=if field=="body" {Value::Markdown(new_value.as_str().unwrap().into())}else{Value::String(new_value.as_str().unwrap().into())};
                let change_start=Instant::now();
                resource.set(property.into(),native,&edit_source).await?;
                resource.save(&edit_source).await?;
                let sender_write_ms=ms(change_start);
                let incoming=binary(&mut socket).await?;
                checked(&incoming)?;
                if incoming[0]!=protocol::tag::UPDATE {return Err("Expected live UPDATE".into());}
                let update=protocol::decode_update(&incoming[1..]).ok_or("Bad UPDATE")?;
                if pure(&update.subject)!=pure(subject) {return Err("Wrong incremental subject".into());}
                let old=receiver.get_resource(&subject.into()).await?;
                atomic_lib::hierarchy::check_write(&receiver,&old,&ForAgent::from(reader.subject.clone())).await?;
                let resolved=atomic_lib::sync::ws_apply::resolve_update(&receiver,subject,&update.loro_bytes).await.ok_or("Live delta failed")?;
                atomic_lib::sync::ws_apply::persist_update(&receiver,subject,resolved).await?;
                changed[collection][0][field]=new_value.clone();
                let observed=receiver.get_resource(&subject.into()).await?;
                if observed.get(property)?.to_string()!=new_value.as_str().unwrap() {return Err("Changed value is not readable".into());}
                let readable_ms=ms(change_start);
                receiver.flush()?;
                let durable_ms=ms(change_start);
                if model::reconstruct(&receiver,&config,&changed).await? != changed {return Err("Incremental fixture differs".into());}
                increments.push(json!({"collection":collection,"field":field,"senderWriteMs":sender_write_ms,
                    "readableMs":readable_ms,"durableMs":durable_ms,"wireBytes":incoming.len(),"crdtUpdateBytes":update.loro_bytes.len(),
                    "oldFieldBytes":serde_json::to_vec(&fixture[collection][0][field])?.len(),"newFieldBytes":serde_json::to_vec(&new_value)?.len(),
                    "durability":"explicit receiver Db::flush after live UPDATE; full fixture verification excluded"}));
            }
            drop(receiver);
            let receiver=open(&directory).await?;
            if model::reconstruct(&receiver,&config,&changed).await? != changed {return Err("Incremental reopen fixture differs".into());}
            fs::write(output.join("incremental-logical-storage.json"),serde_json::to_vec_pretty(&logical_storage(&receiver)?)?)?;
            drop(receiver);
            fs::write(output.join("incremental.json"),serde_json::to_vec_pretty(&json!({"runs":increments,"verifiedAfterReopen":true,"receiverDiskAfterChanges":disk(&directory)?}))?)?;
            let _=socket.close(None).await;
        }
    }
    server.await??;
    Ok(())
}

fn disk(path:&Path)->Result<Json> {
    use std::os::unix::fs::MetadataExt;
    let mut apparent=0u64;let mut allocated=0u64;let mut files=Vec::new();
    fn walk(path:&Path,root:&Path,a:&mut u64,b:&mut u64,files:&mut Vec<Json>)->Result<()> {
        if !path.exists(){return Ok(())}
        for item in fs::read_dir(path)? {let p=item?.path();let m=fs::symlink_metadata(&p)?;
            if m.is_dir(){walk(&p,root,a,b,files)?;}else if m.is_file(){*a+=m.len();*b+=m.blocks()*512;files.push(json!({"path":p.strip_prefix(root)?.to_string_lossy(),"apparentBytes":m.len(),"allocatedBytes":m.blocks()*512}));}}
        Ok(())
    }
    walk(path,path,&mut apparent,&mut allocated,&mut files)?;
    Ok(json!({"apparentBytes":apparent,"allocatedBytes":allocated,"files":files}))
}
fn logical_storage(db:&Db)->Result<Json>{
    let mut result=serde_json::Map::new();
    for tree in Tree::ALL {let mut count=0;let mut key_bytes=0;let mut value_bytes=0;
        for pair in db.kv.iter_tree(tree){let(k,v)=pair?;count+=1;key_bytes+=k.len();value_bytes+=v.len();}
        result.insert(format!("{tree:?}"),json!({"entries":count,"keyBytes":key_bytes,"valueBytes":value_bytes}));}
    Ok(Json::Object(result))
}
