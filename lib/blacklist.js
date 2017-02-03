'use strict';

var iptables = require('iptables') ;
var blacklist = require('./blacklist-regex') ;
var _ = require('lodash') ;
var spawn = require('child_process').spawn;
var assert = require('assert') ;

module.exports = function(opts) {
  assert.ok( typeof opts.chain === 'string', `'opts.chain' is required`) ;

  var chain  = opts.chain ;
  var process = true ;

  // verify the chain exists
  var cmd = spawn('sudo', ['iptables','-S', chain]);
  cmd.stderr.on('data', function(buf) {
      console.error(`error listing chain ${chain}: ${String(buf)}`) ;
      process = false ;
  }) ;

  return function (req, res, next) {
    if( !process ) { return next(); }

    if( req.method !== 'INVITE' && req.method !== 'REGISTER') {
      return next() ;
    }

    var blackholed = false ;
    _.each( blacklist, function(value, key) {
      var matches = 'string' === typeof value ? [value] : value ;
      matches.forEach( function( pattern ) {
        if( blackholed || !req.has(key) ) { return; }
        if( req.get(key).match( pattern ) ) {

          console.error(`${req.get('Call-Id')}: adding src ${req.source_address}/${req.protocol} to the blacklist because of ${key}:${req.get(key)}`) ;
          iptables.drop({
            chain: chain,
            src: req.source_address,
            dport: 5060,
            protocol: req.protocol,
            sudo: true
          }) ;
          blackholed = true ;
        }
      }) ;
    }); 

    if( blackholed ) { 
      // silently discard
      return ;
    }
    
    next() ;
  } ;
} ;
