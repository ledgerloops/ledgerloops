export class GiraffeFriendsEngine {
  protected name: string;
  protected friends: {
    [name: string]: {
      name: string,
      balance: number,
      maxBalance: number,
      exchangeRate: number,
    },
  } = {};
  constructor(name: string) {
    this.name = name;
  }
  addFriend(otherName: string, maxBalance: number = 10.0, exchangeRate: number = 1.0): boolean {
    // console.log(`${this.name} meets ${otherName}`);
    if (typeof this.friends[otherName] !== 'undefined') {
      // console.log(this.debugLog);
      return false;
    }
    this.friends[otherName] = {
      name: otherName,
      balance: 0,
      maxBalance,
      exchangeRate,
    };
    return true;
  }
  setTrust(otherName: string, maxBalance: number): boolean {
    if (typeof this.friends[otherName] === 'undefined') {
      return false;
    }
    this.friends[otherName].maxBalance = maxBalance;
    return true;
  }
  setBalance(otherName: string, balance: number): boolean {
    if (typeof this.friends[otherName] === 'undefined') {
      return false;
    }
    this.friends[otherName].balance = balance;
    return true;
  }
  getFriend(otherName: string): { name: string, balance: number, maxBalance: number, exchangeRate: number } | undefined {
    return this.friends[otherName];
  }
  getFriends(): string[] {
    return Object.keys(this.friends);
  }
  toSnapshot() {
    return this.friends;
  }
  fromSnapshot(snapshot: { [name: string]: { name: string, balance: number, maxBalance: number, exchangeRate: number } }) {
    this.friends = snapshot;
  }
}
export class SaigaFriendsEngine extends GiraffeFriendsEngine {
  constructor(name: string) {
    super(name);
  }
  addFriend(otherName: string, maxBalance: number = 10.0): boolean {
    return super.addFriend(otherName, maxBalance, 1.0);
  }
}
