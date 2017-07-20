const mw = require('drachtio-mw-registration-parser') ;
const parseUri = require('drachtio-sip').parser.parseUri ;
const stringifyContact = require('./utils').stringifyContact ;
const isValidRegister = require('./utils').isValidRegister ;
const _ = require('lodash') ;

/*
module.exports = [mw, function(req, res) {
  const logger = req.app.locals.logger ;

  //use Path header (RFC 3327) unless we know the SBC does not support it
  const supportsPath = !config.has('no-path-support') ? true :
    undefined === _.find(config.get('no-path-support'), (e) => { return `sip:${e}` === req.uri; }) ;

  req.proxy({path: supportsPath}, (err, results) => {
    if (err) {
      return logger.error(err, req.registration, `error proxying REGISTER to ${req.uri}`);
    }
    logger.info(req.registration,
      `${req.registration.type === 'register' ? 'registered' : 'unregistered'} to ` +
      `${req.uri} with status ${results.finalStatus}`);
  }) ;
}] ;
*/

class Register {
  constructor(srf, registrar) {
    this.srf = srf ;
    this.registrar = registrar ;
  }

  start() {

    this.srf.register(mw, (req, res) => {
      const transports = req.app.locals.transports ;
      const callid = req.get('Call-Id') ;
      const logger = req.app.locals.logger.child({callid});
      const ipv4Transport = _.find(transports, function(t) { return !/\[/.test(t.address); });

      logger.debug(`ipv4Transport: ${JSON.stringify(ipv4Transport)}`);
      if (!isValidRegister(req)) {
        logger.info('invalid register request') ;
        return res.send(503);
      }
      const instanceId = req.registration.contact[0].params['+sip.instance'] ;
      const regId = req.registration.contact[0].params['reg-id'] ;
      const uri = parseUri(req.uri) ;

      let headers = {} ;

      // proxy these headers onto the outgoing request, if they appear
      ['from', 'to', 'authorization', 'supported', 'allow', 'user-agent'].forEach((hdr) => {
        if (req.has(hdr)) { headers[hdr] = req.get(hdr) ;}
      }) ;

      // check if we have a call-id / cseq that we are using for this transaction
      const obj = this.registrar.getNextCallIdAndCSeq(callid) ;
      if (obj) {
        Object.assign(headers, obj) ;
      }
      else {
        Object.assign(headers, {'CSeq': '1 REGISTER'}) ;
      }

      const uacContact = req.getParsedHeader('Contact') ;
      const from = req.getParsedHeader('From') ;
      const user = parseUri(from.uri).user ;

      headers.contact = '<sip:' + user + '@' + ipv4Transport.address + '>;expires=' + req.registration.expires ;

      this.srf.request({
        uri: req.uri.replace(/transport=tls/, 'transport=tcp'),
        method: req.method,
        headers: headers
      }, (err, request) => {
        if (err) {
          return logger.error(err, `Error forwarding register to  ${uri.host}`);
        }
        request.on('response', (response) => {
          headers = {} ;
          ['www-authenticate'].forEach(function(hdr) {
            if (response.has(hdr)) {
              headers[hdr] = response.get(hdr) ;
            }
          }) ;

          // construct a contact header
          let expires, contact ;
          if (response.has('Contact')) {
            contact = response.getParsedHeader('Contact') ;
            expires = parseInt(contact[0].params.expires) ;
            uacContact[0].params.expires = expires ;

            headers.contact = stringifyContact(uacContact) ;
          }

          res.send(response.status, response.reason, {
            headers: headers
          }) ;

          if (200 === response.status) {

            const via = req.getParsedHeader('Via') ;
            const transport = (via[0].protocol).toLowerCase() ;

            if ('register' === req.registration.type) {
              this.registrar.addUser(user, {
                expires: Date.now() + (expires * 1000),
                transport: transport,
                source_address: req.source_address,
                source_port: req.source_port,
                uri: req.registration.contact[0].uri,
                instanceId:instanceId,
                regId: regId,
                aor: req.registration.aor
              }) ;
              if (!this.registrar.hasTransaction(callid)) {
                this.registrar.addTransaction({
                  aCallId: callid,
                  bCallId: response.get('Call-Id'),
                  bCseq: response.get('CSeq')
                }) ;
              }
            }
            else {
              this.registrar.removeUser(user) ;
              this.registrar.removeTransaction(req.get('call-id')) ;
            }
          }
          else if ([401, 407].indexOf(response.status) !== -1) {
            this.registrar.addTransaction({
              aCallId: callid,
              bCallId: response.get('Call-Id'),
              bCseq: response.get('CSeq')
            }) ;
          }
          else if (401 !== response.status) {
            logger.info(`register failed with ${response.status}`) ;
          }
        });
      });
    });
  }
}
module.exports = exports = Register ;

