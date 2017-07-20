const _ = require('lodash') ;
const config = require('config');
const parseUri = require('drachtio-sip').parser.parseUri ;

class Registrar {
  constructor(logger) {
    this.logger = logger ;
    this.users = new Map() ;
    this.transactions = new Map() ;
  }

  addUser(user, obj) {
    if (config.contactRewrite === true) {
      const c = parseUri(obj.uri) ;
      if (c && c.family === 'ipv4') {
        let newContact = c.schema + ':' + c.user + '@' + obj.source_address + ':' + obj.source_port ;
        _.each(c.params, (value, key) => {
          newContact += ';' + key + '=' + value ;
        }) ;
        obj.uri = newContact ;
      }
    }
    this.users.set(user, obj) ;
    this.logger.info(`added user ${user} with contact ${obj.uri}, there are now ${this.users.size} users`) ;
  }

  removeUser(user) {
    this.users.delete(user);
    this.logger.info(`received an unregister for user ${user}, there are now ${this.users.size} users`);
  }

  hasUser(user) {
    return this.users.has(user);
  }

  getUser(user) {
    return this.users.get(user) ;
  }

  addTransaction(c) {
    this.transactions.set(c.aCallId, c) ;
    console.log(`added transaction ${c.aCallId}, now have ${this.transactions.size}`) ;
  }

  getNextCallIdAndCSeq(callid) {
    const obj = this.transactions.get(callid) ;
    if (obj) {
      const arr = /^(\d+)\s+(.*)$/.exec(obj.bCseq) ;
      if (arr) {
        obj.bCseq = (++arr[1]) + ' ' + (arr[2]) ;
        return {
          'Call-Id': obj.bCallId,
          'CSeq': obj.bCseq
        };
      }
    }
  }

  hasTransaction(callid) {
    return this.transactions.has(callid) ;
  }

  removeTransaction(callid) {
    this.transactions.delete(callid) ;
  }

}

module.exports = exports = Registrar ;

