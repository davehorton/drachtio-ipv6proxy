const dgram = require('dgram');
const bencode = require('bencode');
const uuid = require('uuid/v4') ;
const Emitter = require('events').EventEmitter ;
const debug = require('debug')('drachtio-rtpengine-webrtcproxy') ;

class Rtpengine extends Emitter {

  constructor(logger, host, port, localAddress, localPort) {
    super() ;
    this.host = host ;
    this.port = port ;
    this.logger = logger ;

    debug(`Rtpengine: host ${this.host} port ${this.port}`);
    debug(`Rtpengine: localAddress ${localAddress} localPort ${localPort}`);

    this.client = dgram.createSocket('udp4');
    this.client.on('message', this._onMessage.bind(this)) ;
    this.client.on('error', this._onError.bind(this)) ;
    this.client.on('listening', this._onListening.bind(this));
    this.client.bind(localPort, localAddress) ;

    this._messages = new Map() ;
  }

  command(name, opts, callback) {
    opts = opts || {} ;
    const cookie = uuid() ;

    Object.assign(opts, {command: name}) ;
    this.logger.debug(`RtpEngine: sending command: ${cookie}: ${JSON.stringify(opts)}`) ;

    const message = new Buffer(
      [cookie, bencode.encode(opts)].join(' ')
    );

    if (callback) {
      this._messages.set(cookie, callback) ;
    }
    this.client.send(message, this.port, this.host, (err) => {
      if (err) {
        this.logger.error(`error sending command to rtpengine at ${this.host}:${this.port}`) ;
        this._messages.delete(cookie) ;
        return ;
      }
    }) ;
  }

  _onMessage(msg, rinfo) {
    var m = msg.toString() ;
    var idx = m.indexOf(' ') ;
    if (-1 === idx) {
      this.logger.error(`RtpEngine#_onMessage: malformed message: ${msg}`) ;
      return ;
    }

    var cookie = m.substring(0, idx) ;
    var callback = this._messages.get(cookie) ;
    var data = m.substring(idx + 1);
    var obj = bencode.decode(data, 'utf8') ;
    this.logger.debug(`RtpEngine: received response: ${cookie}: ${JSON.stringify(obj)}`) ;

    if (!callback) {
      return ;
    }

    this._messages.delete(cookie) ;
    callback(null, obj) ;
  }

  _onError(err) {
    this.logger.error(`RtpEngine#_onError: ${JSON.stringify(err)}`) ;
    this.emit('error', err) ;
  }

  _onListening() {
    this.emit('listening') ;
  }
}

['answer', 'delete', 'list', 'offer', 'ping', 'query', 'startRecording'].forEach((method) => {
  Rtpengine.prototype[method] = function(opts, callback) {
    if (typeof opts === 'function') {
      callback = opts ;
      opts = {} ;
    }
    return this.command(method, opts, callback) ;
  } ;
}) ;
module.exports = Rtpengine ;
