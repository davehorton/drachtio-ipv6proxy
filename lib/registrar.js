'use strict' ;


var Emitter = require('events').EventEmitter ;
var util = require('util') ;
var _ = require('lodash') ;
var config = require('./config');
var parseUri = require('drachtio-sip').parser.parseUri ;

module.exports = exports = Registrar ;

function Registrar(){

  if (!(this instanceof Registrar)) { return new Registrar(); }

  Emitter.call(this); 

  this.users = new Map() ;
  this.transactions = new Map() ;

}
util.inherits(Registrar, Emitter) ;

// Users 
Registrar.prototype.addUser = function( user, obj ) {
  if( config.contactRewrite === true ) {
    var c = parseUri( obj.uri ) ;
    if( c && c.family === 'ipv4' ) {
      var newContact = c.schema + ':' + c.user + '@' + obj.source_address + ':' + obj.source_port ;
      _.each( c.params, function(value, key) {
        newContact += ';' + key + '=' + value ;
      }) ;  
      obj.uri = newContact ;      
    }
  }
  if( !this.users.has( user ) ) {
    console.log('added user %s with contact %s, there are now %d users', user, obj.uri, this.users.size + 1) ;
  }
  this.users.set( user, obj ) ;
} ;
Registrar.prototype.removeUser = function( user ) {
  this.users.delete( user )  ;
  console.log('received an unregister for user %s, there are now %d users', user, this.users.size) ;
}; 
Registrar.prototype.hasUser = function( user ) {
  return this.users.has( user ) ;
} ;
Registrar.prototype.getUser = function( user ) {
  return this.users.get( user ) ;
}; 

Registrar.prototype.addTransaction = function(c) {
  this.transactions.set(c.aCallId, c) ;
  console.log(`added transaction ${c.aCallId}, now have ${this.transactions.size}`) ;
};
Registrar.prototype.getNextCallIdAndCSeq = function(callid) {
  var obj = this.transactions.get(callid) ;
  if( obj ) {
    var arr = /^(\d+)\s+(.*)$/.exec( obj.bCseq ) ;
    if( arr ) {
      obj.bCseq = (++arr[1]) + ' ' + (arr[2] ) ;
      return {
        'Call-Id': obj.bCallId,
        'CSeq': obj.bCseq 
      };
    }
  }
} ;
Registrar.prototype.hasTransaction = function(callid) {
  return this.transactions.has(callid) ;
} ;
Registrar.prototype.removeTransaction = function(callid) {
  this.transactions.delete( callid ) ;
  console.log(`removed transaction ${callid}, now have ${this.transactions.size}`) ;
} ;
 