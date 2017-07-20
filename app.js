const config = require('config') ;
const Srf = require('drachtio-srf') ;
const srf = new Srf(config.get('drachtio')) ;
const Rtpengine = require('./lib/rtpengine') ;
const pino = require('pino');
const logger = srf.locals.logger = pino({
  serializers: {
    err: pino.stdSerializers.err
  }
});
const rtpengine = new Rtpengine(logger,
  config.get('rtpengine.ng-address'),
  config.get('rtpengine.ng-port'),
  config.get('rtpengine.local-address'),
  config.get('rtpengine.local-port')
) ;

const _ = require('lodash');

logger.level = config.has('logger.level') ? config.get('logger.level') : 'debug' ;

exports = module.exports = srf ;

srf.on('connect', (err, hostport) => {
  srf.locals.hostport = hostport ;
  srf.locals.transports = _.map(hostport.split(','), (s) => {
    const arr = /(.*)\/(.*)/.exec(s) ;
    if (arr) {
      return {
        protocol: arr[1],
        address: arr[2]
      } ;
    }
    return {} ;
  });
  logger.info(`connected to drachtio listening for SIP on ${hostport}`) ;
  logger.debug(srf.locals.transports) ;
})
  .on('error', (err) => {
    logger.error(err, 'Error connecting to drachtio server') ;
  }) ;

const Register = require('./lib/register') ;
const Registrar = require('./lib/registrar') ;
const CallProcessor = require('./lib/call-processor') ;
const Subscriber = require('./lib/subscriber') ;

const registrar = new Registrar(logger) ;
const register = new Register(srf, registrar) ;
const callProcessor = new CallProcessor(srf, rtpengine, registrar) ;
const subscriber = new Subscriber(srf, registrar) ;

register.start() ;
subscriber.start() ;
callProcessor.start() ;

