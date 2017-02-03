'use strict' ;

var Emitter = require('events').EventEmitter ;
var util = require('util') ;
var b2bWithRtp = require('./b2b-with-rtp-proxy') ;
var spawn = require('child_process').spawn;
var parseUri = require('drachtio-sip').parser.parseUri ;
var ban = true ;
var chain = 'LOGDROP';

// verify the chain exists
var cmd = spawn('sudo', ['iptables','-S', chain]);
cmd.stderr.on('data', function(buf) {
    console.error(`NB: blacklisting is disabled, error listing chain ${chain}: ${buf}`) ;
    ban = false ;
}) ;

module.exports = exports = CallProcessor ;

function CallProcessor( srf, mediaServer, registrar ){

  if (!(this instanceof CallProcessor)) { return new CallProcessor(srf, mediaServer, registrar); }

  Emitter.call(this); 

  console.log('mediaServer: ', mediaServer); 

  this._srf = srf ;
  this._mediaServer = mediaServer ;
  this._registrar = registrar ;
  this.calls = new Map() ;

}
util.inherits(CallProcessor, Emitter) ;

CallProcessor.prototype.start = function() {
  this._srf.invite( ( req, res ) => {

    console.log(`received invite from ${req.protocol}/${req.source_address}:${req.source_port} with request uri ${req.uri}`) ;

    //identify B leg request uri
    var arr = /^<(.*)>/.exec( req.get('Contact') ) ;  //strip brackets 
    var contact = arr ? arr[1] : req.get('Contact') ;
  
    var uri = req.uri ;
    var user = parseUri( req.uri ).user ;
    if( this._registrar.hasUser( user ) ) {
      uri = this._registrar.getUser( user ).uri ;
    }
    var uasFamily = parseUri( contact ).family ;
    var uacFamily = parseUri( uri ).family ;

    b2bWithRtp( this._srf, req, res, uri, this._mediaServer, uasFamily, uacFamily, this._registrar, (err, uas, uac, ms, ep1, ep2) => {
      if( err ) {
        console.error('%s: error connecting call: %s', req.get('Call-Id'), err.message) ;
        return ;
      }
      console.log(`call with request uri ${req.uri} connected`) ;

      this.setHandlers( uas, uac, ms, ep1, ep2 ) ;
    }) ;
  });  
} ;


CallProcessor.prototype.setHandlers = function( uas, uac, ms, ep1, ep2 ) {
  var key = makeReplacesStr(uas) ;
  var value = makeReplacesStr(uac) ;

  this.calls.set(key, value) ;

  console.log(`after adding call there are now ${this.calls.size} calls in progress`);

  uas.on('destroy', this._onDestroy.bind( this, uas, uac, ms, ep1, ep2 )) ;
  uac.on('destroy', this._onDestroy.bind( this, uac, uas, ms, ep1, ep2 )) ;

  uas.once('refer', this._handleRefer.bind( this, uas, uac ) ) ;
  uac.once('refer', this._handleRefer.bind( this, uac, uas ) ) ;

  uas.on('hold', this._hold.bind( this, uas, uac, ep1, ep2 )) ;
  uac.on('hold', this._hold.bind( this, uac, uas,  ep1, ep2 )) ;

  uas.on('unhold', this._unhold.bind( this, uas, uac, ep1, ep2 )) ;
  uac.on('unhold', this._unhold.bind( this, uac, uas, ep1, ep2 )) ;
} ;

CallProcessor.prototype._onDestroy = function( dlg, dlgOther, ms, ep1, ep2 ) {

  var key = makeReplacesStr(dlg) ;
  if( this.calls.has( key ) ) {
    this.calls.delete(key) ;
  }
  else {
    key = makeReplacesStr(dlgOther) ;
    if( this.calls.has( key ) ) {
      this.calls.delete(key) ;
    }
    else {
      console.error(`key ${key} not found in calls map`);
    }
  }
  [dlgOther, ep1, ep2].forEach( function(e) { e.destroy(); }) ;
  ms.disconnect() ;

  console.log(`after ending call there are now ${this.calls.size} calls in progress`);

} ;

CallProcessor.prototype._handleRefer = function( dlg, dlgOther, req, res  ) {
  var referTo = req.get('Refer-To') ;
  var arr = /(.*)Replaces=(.*)>/.exec(referTo) ;

  if( arr && arr.length > 1 ) {

    // attended transfer: fixup the Replaces part of the Refer-To header
    var key = arr[2] ;
    if( key in this._calls ) {
      referTo = arr[1] + 'Replaces=' + this._calls[key] + '>' ;
    }
    else {
      console.error(`attended transfer but we cant find key ${key}`);
      return res.send(500) ;
    }
  }

  dlgOther.request({
    method: 'REFER',
    headers: {
      'Refer-To': referTo
    }
  });

  res.send(202);
} ;

CallProcessor.prototype._hold = function( dlg, dlgOther, ep1 /*, ep2 */) {
  ep1.unbridge( function(err) {
    if( err ) {
      console.error('Error unbridging endpoints when going on hold: ', err) ;
    }
  }); 
} ;

CallProcessor.prototype._unhold = function( dlg, dlgOther, ep1, ep2 ) {
  ep1.bridge( ep2, function(err) {
    if( err ) {
      console.error('Error bridging endpoints back together after unhold: ', err) ;
    }
  }); 
} ;


function makeReplacesStr( dlg ) {
  var s = '';
  if( dlg.type === 'uas') {
    s = encodeURIComponent( dlg.sip.callId + ';to-tag=' + dlg.sip.localTag + ';from-tag=' + dlg.sip.remoteTag ) ;
  }
  else {
    s = encodeURIComponent( dlg.sip.callId + ';to-tag=' + dlg.sip.remoteTag + ';from-tag=' + dlg.sip.localTag ) ;    
  }
  return s ;
}
