var Mrf = require('drachtio-fsmrf') ;
var app = require('../app'); 
var mrf = new Mrf(app) ;
var async = require('async') ;

// iterate through available media servers until we successfully connect and create two endpoints, or exhaust all media servers
function connectAndCreateEndpointPair( req, uri, mediaServer, uasFamily, uacFamily, callback ) {
  var exhaustedMediaServers = false ;
  var idx = 0 ;
  var haveResources = false ;
  var callId = req.get('Call-Id') ;
  
  async.doUntil(
    function tryNext(callback) {
      async.waterfall([
        function connectToMs( callback ) {
          mrf.connect(mediaServer[idx++], 
            function(ms) {
              callback(null, req, ms) ;
            }, 
            function(err) {
              console.error(`${callId}: Error connecting to media server #${idx}: ${err.message}`) ;
              callback(err) ;
            }
          );          
        }, 
        function allocateUas( req, ms, callback ) {
          ms.createEndpoint({
            family: uasFamily,
            remoteSdp: req.body,
          }, function( err, ep ) {
            if( err ) {
              console.error(`${callId}: Error creating UAS-facing endpoint}: ${err.message}`) ;
              return callback(err, ms) ;
            }
            callback(null, ms, ep); 
          }); 
        }, 
        function allocateUac( ms, epUas, callback ) {
          ms.createEndpoint( {
            family: uacFamily
          }, function( err, ep ) {
            if( err ) {
              console.error(`${callId}: Error creating UAC-facing endpoint}: ${err.message}`) ;
              epUas.destroy() ;
              return callback(err, ms, epUas) ;
            }
            callback(null, ms, epUas, ep); 
          }); 
        }
      ], 
      function(err, ms, epUas, epUac) {
        if( err ) {

          // try next media server, if any
          if( idx === mediaServer.length ) {
            exhaustedMediaServers = true ;

          }
          callback(exhaustedMediaServers ? new Error('GLOBAL-MS-FAILURE') : null, ms, epUas, epUac) ;
        }
        else {
          haveResources = true ;
          callback( null, ms, epUas, epUac ) ;
        }
      }); 
    }, 
    function test() {
      return haveResources || exhaustedMediaServers ;
    }, 
    function wrapUp(err, ms, epUas, epUac) {
      if( err ) {
        return callback(err, ms, epUas, epUac) ;
      }
      return callback( null, ms, epUas, epUac ) ;
    }
  ) ;
}

module.exports = function( srf, req, res, uri, mediaServer, uasFamily, uacFamily, registrar, callback ) {

  var canceled = false ;
  var callId = req.get('Call-Id');

  req.on('cancel', function() {
    canceled = true ;
  }) ;

  async.waterfall([
    connectAndCreateEndpointPair.bind( this, req, uri, mediaServer, uasFamily, uacFamily ),

    function bridgeEndpoints(ms, epUas, epUac, callback) {
      epUas.bridge( epUac, function(err) {
        if( err ) {
          console.error(`${callId}: Error bridging endpoints: ${err.message}`) ;
          return callback(err, ms, epUas, epUac) ;
        }
        callback(null, ms, epUas, epUac);         
      }) ;
    }
    ], function(err, ms, epUas, epUac) {
      if( err ) {
        res.send(err.status || 480);
        if( epUas ) { epUas.destroy(); }
        if( epUac ) { epUac.destroy(); }
        if( ms ) { ms.disconnect(); }
        return callback( err ) ;
      }
      if( canceled ) {
        epUas.destroy() ;
        epUac.destroy() ;
        ms.disconnect() ;
        req.removeAllListeners('cancel') ;
        return callback( new Error({status:487, message: 'call canceled'})) ;
      }

      var uacRemoteSdp ;
      var inviteSent ;

      // check if we have a call-id / cseq that we used previously on a 407-challenged INVITE
      var headers = {} ;
      var obj = registrar.getNextCallIdAndCSeq( callId ) ;
      if( obj ) {
        Object.assign( headers, obj ) ;
      }
      else {
        Object.assign( headers, {'CSeq': '1 INVITE'}) ;
      }

      srf.createBackToBackDialogs( req, res, uri, {
        localSdpA: epUas.local.sdp,
        localSdpB: epUac.local.sdp, 
        headers: headers,
        proxyRequestHeaders: ['from','to','proxy-authorization','supported','allow','content-type','user-agent','X-Linked-UUID','X-Slot','X-Server'],
        proxyResponseHeaders: ['proxy-Authenticate','accept','allow','allow-events','X-Linked-UUID'],
        onProvisional: function( provisionalResponse ) {
          if( !!provisionalResponse.body && provisionalResponse.body !== uacRemoteSdp ) {
            epUac.modify( provisionalResponse.body ) ;
            uacRemoteSdp = provisionalResponse.body ;
          }
        }
      }, function( err, uasDialog, uacDialog ) {
        if( err ) {
          if( err.status === 487 ) {
            console.log(`${callId}: caller hung up before answer`) ;
          }
          else if( [401,407].indexOf( err.status ) !== -1 ) {
            if( inviteSent ) {
              registrar.addTransaction({
                aCallId: callId,
                bCallId: inviteSent.get('Call-Id'),
                bCseq: inviteSent.get('CSeq')
              }) ;              
            }
            console.log(`${callId}: call was challenged for credentials`) ;
          }
          else {
            console.error(`${callId}: error completing call: ${err.status || err.message || err}`) ;
          }

          console.log(`destroying uac endpoint`) ;
          epUac.destroy() ;
          console.log(`destroying uas endpoint`) ;
          epUas.destroy() ;
          ms.disconnect() ;
          return callback(err);
        }
        
        epUac.modify( uacDialog.remote.sdp ) ;

        callback(null, uasDialog, uacDialog, ms, epUas, epUac) ;

      }).then( function( uacRequest ) {
        inviteSent = uacRequest ;
      }) ; 
    }
  ) ;
} ;
