(function (global, factory) {
  if (typeof define === "function" && define.amd) {
    define(['exports'], factory);
  } else if (typeof exports !== "undefined") {
    factory(exports);
  } else {
    var mod = {
      exports: {}
    };
    factory(mod.exports);
    global.WebRTC = mod.exports;
  }
})(this, function (exports) {
  'use strict';

  Object.defineProperty(exports, "__esModule", {
    value: true
  });

  function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
      throw new TypeError("Cannot call a class as a function");
    }
  }

  var _createClass = function () {
    function defineProperties(target, props) {
      for (var i = 0; i < props.length; i++) {
        var descriptor = props[i];
        descriptor.enumerable = descriptor.enumerable || false;
        descriptor.configurable = true;
        if ("value" in descriptor) descriptor.writable = true;
        Object.defineProperty(target, descriptor.key, descriptor);
      }
    }

    return function (Constructor, protoProps, staticProps) {
      if (protoProps) defineProperties(Constructor.prototype, protoProps);
      if (staticProps) defineProperties(Constructor, staticProps);
      return Constructor;
    };
  }();

  var URL = window.URL || window.webkitURL || window.mozURL || window.msURL;
  var RTCPeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;
  var RTCSessionDescription = window.RTCSessionDescription || window.mozRTCSessionDescription;
  var RTCIceCandidate = window.RTCIceCandidate || window.mozRTCIceCandidate;

  var availableDevices = {
    cam: null,
    mic: null
  };
  if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
    navigator.mediaDevices.enumerateDevices().then(function (devices) {
      devices.forEach(function (device) {
        if (device.kind === 'videoinput' || device.kind === 'video') {
          availableDevices.cam = true;
        }
        if (device.kind === 'audioinput' || device.kind === 'audio') {
          availableDevices.mic = true;
        }
      });
    });
    if (availableDevices.cam === null) {
      availableDevices.cam = false;
    }
    if (availableDevices.mic === null) {
      availableDevices.mic = false;
    }
  } else {
    availableDevices.cam = true;
    availableDevices.mic = true;
  }
  var supported = !!(URL && URL.createObjectURL && RTCPeerConnection && document.location.protocol === 'https:');

  var WebRTC = function () {
    _createClass(WebRTC, null, [{
      key: 'getStreamUrl',
      value: function getStreamUrl(stream) {
        var url = void 0;
        try {
          url = URL.createObjectURL(stream) || stream;
        } catch (e) {
          url = stream;
        }
        return url;
      }
    }, {
      key: 'stopStream',
      value: function stopStream(stream) {
        if (stream) {
          if (stream.stop) {
            stream.stop();
          }
          if (stream.getVideoTracks && stream.getVideoTracks()[0]) {
            stream.getVideoTracks()[0].enabled = false;
          }
          if (stream.getAudioTracks && stream.getAudioTracks()[0]) {
            stream.getAudioTracks()[0].enabled = false;
          }
          if (stream.getTracks) {
            var tracks = stream.getTracks();
            tracks.forEach(function (track) {
              if (track && track.stop) {
                track.stop();
              }
            });
          }
        }
      }
    }]);

    function WebRTC(endpoint, room, id, localStream) {
      var _this = this;

      _classCallCheck(this, WebRTC);

      this.endpoint = endpoint;
      this.room = room;
      this.id = id;
      this.remote = null;
      this.listeners = {};
      this.localStream = localStream;
      this.destroyed = false;
      this.mediaConstraints = {
        mandatory: {
          OfferToReceiveAudio: true,
          OfferToReceiveVideo: true
        }
      };
      this.socket = new WebSocket(this.endpoint);
      this.socket.onopen = function () {
        _this.signal('join', {
          id: _this.id,
          room: _this.room
        });
        _this.trigger(WebRTC.EVENT_START);
      };
      this.socket.onclose = function () {
        _this.trigger(WebRTC.EVENT_END);
      };
      this.socket.onerror = function (err) {
        _this.trigger(WebRTC.EVENT_ERROR, err);
      };
      this.socket.onmessage = function (message) {
        var msg = void 0;
        try {
          msg = JSON.parse(message.data);
        } catch (e) {
          _this.trigger(WebRTC.EVENT_ERROR, new Error('Parsing signaling server message: ' + message.data));
          return;
        }
        var localName = 'signal' + (msg.fn.substr(0, 1).toUpperCase() + msg.fn.substr(1));
        if (_this[localName]) {
          _this[localName](msg.id, msg.payload);
        }
        _this.trigger(WebRTC.EVENT_SIGNAL_MESSAGE, msg);
      };
    }

    _createClass(WebRTC, [{
      key: 'hangup',
      value: function hangup() {
        if (this.destroyed) {
          return;
        }
        WebRTC.stopStream(this.localStream);
        if (this.remote && this.remote.connection && this.remote.connection.stream) {
          WebRTC.stopStream(this.remote.connection.stream);
        }
        this.signal('leave');
        var socket = this.socket;
        this.destroyed = true;
        this.listeners = {};
        this.socket = null;
        setTimeout(function () {
          socket.close();
        }, 1000);
      }
    }, {
      key: 'signalJoin',
      value: function signalJoin(senderId) {
        var _this2 = this;

        if (senderId === this.id) {
          return;
        }
        if (!this.remote) {
          this.remote = { id: senderId, connection: null };
          this.addPeerConnection(senderId);
          this.remote.connection.createOffer(function (sessionDescription) {
            _this2.signal('offer', {
              target: senderId,
              payload: sessionDescription
            });
            _this2.remote.connection.setLocalDescription(sessionDescription);
          }, function (err) {
            _this2.trigger(WebRTC.EVENT_ERROR, err);
          }, this.mediaConstraints);
        }
      }
    }, {
      key: 'signalLeave',
      value: function signalLeave(senderId) {
        if (this.remote && this.remote.id === senderId) {
          this.remote = null;
          this.hangup();
        }
      }
    }, {
      key: 'signalIceCandidate',
      value: function signalIceCandidate(senderId, iceCandidate) {
        if (iceCandidate.candidate && this.remote && this.remote.id === senderId) {
          this.remote.connection.addIceCandidate(new RTCIceCandidate({
            sdpMLineIndex: iceCandidate.label,
            candidate: iceCandidate.candidate
          }));
        }
      }
    }, {
      key: 'signalOffer',
      value: function signalOffer(senderId, offer) {
        var _this3 = this;

        this.remote = { id: senderId, connection: null };
        this.addPeerConnection(senderId);
        this.remote.connection.setRemoteDescription(new RTCSessionDescription(offer));
        this.remote.connection.createAnswer(function (sessionDescription) {
          _this3.remote.connection.setLocalDescription(sessionDescription);
          _this3.signal('answer', {
            target: senderId,
            payload: sessionDescription
          });
        }, function (err) {
          _this3.trigger(WebRTC.EVENT_ERROR, err);
        }, this.mediaConstraints);
      }
    }, {
      key: 'signalAnswer',
      value: function signalAnswer(senderId, answer) {
        if (this.remote && this.remote.id === senderId) {
          this.remote.connection.setRemoteDescription(new RTCSessionDescription(answer));
        }
      }
    }, {
      key: 'addPeerConnection',
      value: function addPeerConnection(id) {
        var _this4 = this;

        if (this.remote && this.remote.id === id) {
          var pc = new RTCPeerConnection({ iceServers: WebRTC.iceServers }, this.mediaConstraints);
          pc.onicecandidate = function (event) {
            if (event.candidate) {
              _this4.signal('iceCandidate', {
                payload: {
                  type: 'candidate',
                  label: event.candidate.sdpMLineIndex,
                  id: event.candidate.sdpMid,
                  candidate: event.candidate.candidate
                },
                target: id
              });
            }
          };
          pc.onaddstream = function (event) {
            pc.stream = event.stream;
            _this4.trigger(WebRTC.EVENT_CONNECTED, event.stream);
          };
          pc.onremovestream = function () {
            if (_this4.remote && _this4.remote.id === id) {
              _this4.remote.connection = null;
              _this4.remote.remoteStreamURL = null;
              _this4.trigger(WebRTC.EVENT_END, id);
            }
          };
          if (this.localStream) {
            pc.addStream(this.localStream);
          }
          pc.streamURL = '';
          pc.stream = '';
          this.remote.connection = pc;
          this.trigger(WebRTC.EVENT_FOUND_REMOTE);
        }
      }
    }, {
      key: 'addListener',
      value: function addListener(event, cb) {
        if (!this.listeners[event]) {
          this.listeners[event] = [];
        }
        this.listeners[event].push(cb);
      }
    }, {
      key: 'trigger',
      value: function trigger(event, data) {
        if (this.listeners[event]) {
          this.listeners[event].forEach(function (cb) {
            cb(data);
          });
        }
      }
    }, {
      key: 'signal',
      value: function signal(fn, data) {
        this.trigger(WebRTC.EVENT_SIGNAL_SEND, { fn: fn, data: data });
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
          this.socket.send(JSON.stringify({
            fn: fn,
            data: data
          }));
        }
      }
    }]);

    return WebRTC;
  }();

  WebRTC.EVENT_START = 'start';
  WebRTC.EVENT_END = 'end';
  WebRTC.EVENT_ERROR = 'error';
  WebRTC.EVENT_SIGNAL_MESSAGE = 'signalMessage';
  WebRTC.EVENT_SIGNAL_SEND = 'signalSend';
  WebRTC.EVENT_CONNECTED = 'connected';
  WebRTC.EVENT_FOUND_REMOTE = 'foundRemote';
  WebRTC.availableDevices = availableDevices;
  WebRTC.supported = supported;
  WebRTC.iceServers = [{
    url: 'stun:148.251.126.74:5349'
  }, {
    url: 'turn:148.251.126.74:5349',
    username: 'vl',
    credential: 'bfPB1VMy'
  }, {
    url: 'stun:148.251.126.74:3478'
  }, {
    url: 'turn:148.251.126.74:3478',
    username: 'vl',
    credential: 'bfPB1VMy'
  }, { urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:stun2.l.google.com:19302' }, { urls: 'stun:stun3.l.google.com:19302' }, { urls: 'stun:stun4.l.google.com:19302' }, { urls: 'stun:stun01.sipphone.com' }, { urls: 'stun:stun.ekiga.net' }, { urls: 'stun:stun.fwdnet.net' }, { urls: 'stun:stun.ideasip.com' }, { urls: 'stun:stun.iptel.org' }, { urls: 'stun:stun.rixtelecom.se' }, { urls: 'stun:stun.schlund.de' }, { urls: 'stun:stunserver.org' }, { urls: 'stun:stun.softjoys.com' }, { urls: 'stun:stun.voiparound.com' }, { urls: 'stun:stun.voipbuster.com' }, { urls: 'stun:stun.voipstunt.com' }, { urls: 'stun:stun.voxgratia.org' }, { urls: 'stun:stun.xten.com' }];

  exports.default = WebRTC;
});
