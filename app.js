'use strict';

var drachtio = require('drachtio') ;
var app = drachtio() ;
var Srf = require('drachtio-srf') ;
var srf = new Srf(app) ;
var blacklist = require('./lib/blacklist');
var config = require('./lib/config') ;
var _ = require('lodash');


exports = module.exports = app ;

srf.connect(config.drachtio) 
.on('connect', function(err, hostport) {
  app.hostport = hostport ;
  app.transports = _.map( hostport.split(','), function(s) {
    var arr = /(.*)\/(.*)/.exec( s ) ;
    if( arr ) {
      return {
        protocol: arr[1],
        address: arr[2]
      } ;
    }
    return {} ;
  });
  console.log('connected to drachtio listening for SIP on %s', hostport) ;
  console.log('transports %s', JSON.stringify(app.transports)) ;
})
.on('error', function(err){
  console.error('Error connecting to drachtio server: ', err.message ) ;
})
.on('reconnecting', function(opts) {
  console.error('attempting to reconect: ', opts) ;
}) ;


var Register = require('./lib/register') ;
var Registrar = require('./lib/registrar') ;
var CallProcessor = require('./lib/call-processor') ;
var Subscriber = require('./lib/subscriber') ;

var registrar = new Registrar() ;
var register = new Register(srf, registrar) ;
var callProcessor = new CallProcessor(srf, config.mediaServer, registrar) ;
var subscriber = new Subscriber(srf, registrar) ;

srf.use( blacklist({chain: 'LOGDROP'}) ) ;

register.start() ;
subscriber.start() ;
callProcessor.start() ;
