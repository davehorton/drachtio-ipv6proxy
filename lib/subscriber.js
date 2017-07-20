const parseUri = require('drachtio-sip').parser.parseUri ;

class Subscriber {
  constructor(srf, registrar) {
    this.srf = srf ;
    this.registrar = registrar ;
  }

  start() {
    this.srf.subscribe((req, res) => {
      const callid = req.get('Call-Id') ;
      const logger = req.app.locals.logger.child({callid});

      logger.info(`UAC subscribing for ${req.get('Event')}: ${req.protocol}/${req.source_address}:${req.source_port}`) ;

      // only registered users are allowed to subscribe
      const from = req.getParsedHeader('from') ;
      const fromUser = parseUri(from.uri).user ;

      if (!this.registrar.hasUser(fromUser)) {
        logger.info(`invalid user ${fromUser} attempting to subscribe`) ;
        return res.send(503);
      }

      this.srf.createBackToBackDialogs(req, res,
        req.uri.replace(/transport=tls/, 'transport=tcp'),
        {
          method: 'SUBSCRIBE',
          proxyRequestHeaders: ['event', 'expires', 'allow'],
          proxyResponseHeaders: ['subscription-state', 'expires', 'allow-events']
        }, (err) => {
          if (err) {
            return logger.error(err, 'Error establishing subscribe dialog') ;
          }
        }) ;
    });
  }
}

module.exports = exports = Subscriber ;
