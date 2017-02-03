'use strict' ;

var Emitter = require('events').EventEmitter ;
var util = require('util') ;
var parseUri = require('drachtio-sip').parser.parseUri ;

module.exports = exports = Subscriber ;

function Subscriber( srf, registrar ){

  if (!(this instanceof Subscriber)) { return new Subscriber(srf, registrar); }

  Emitter.call(this); 

  this.srf = srf ;
  this._registrar = registrar ;

}
util.inherits(Subscriber, Emitter) ;

Subscriber.prototype.start = function() {

  this.srf.subscribe( ( req, res ) => {

    console.log(`UAC subscribing for ${req.get('Event')}: ${req.protocol}/${req.source_address}:${req.source_port}`) ;

    // only registered users are allowed to subscribe
    var from = req.getParsedHeader('from') ;
    var fromUser = parseUri( from.uri ).user ;

    if( !this._registrar.hasUser( fromUser ) ) {
      console.log(`invalid user ${fromUser} attempting to subscribe`, fromUser) ;
      return res.send(503);
    }

    this.srf.createBackToBackDialogs( req, res, req.uri, {
      method: 'SUBSCRIBE',
      proxyRequestHeaders: ['event','expires','allow'],
      proxyResponseHeaders: ['subscription-state','expires','allow-events']
    }, (err) => {
      if( err ) {
        return console.error(`Error establishing subscribe dialog: ${err}`) ;
      }
    }) ;
  });
} ;
