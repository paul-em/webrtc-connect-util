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

  var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) {
    return typeof obj;
  } : function (obj) {
    return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj;
  };

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

  var protocolSupport = document.location.protocol === 'https:' || document.location.hostname === 'localhost';
  var supported = !!(URL && URL.createObjectURL && RTCPeerConnection && protocolSupport);

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
    }, {
      key: 'guid',
      value: function guid() {
        function s4() {
          return Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
        }

        return s4() + s4() + s4();
      }
    }]);

    function WebRTC(props) {
      var _this = this;

      _classCallCheck(this, WebRTC);

      if (!props || (typeof props === 'undefined' ? 'undefined' : _typeof(props)) !== 'object' || !props.endpoint || !props.room) {
        throw new Error('Specify endpoint and room in constructor');
      }

      this.endpoint = props.endpoint;
      this.room = props.room;
      this.roomType = props.roomType;
      this.master = this.roomType === WebRTC.ROOM_TYPE_1_TO_N && props.master;
      this.id = props.id || WebRTC.guid();
      this.remotes = [];
      this.listeners = {};
      this.localStream = props.localStream;
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
          room: _this.room,
          type: _this.roomType,
          master: _this.master
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
        this.destroyed = true;
        this.trigger(WebRTC.EVENT_END);
        WebRTC.stopStream(this.localStream);
        this.remotes.forEach(function (remote) {
          if (remote && remote.connection && remote.connection.stream) {
            WebRTC.stopStream(remote.connection.stream);
          }
        });
        this.signal('leave');
        var socket = this.socket;
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
        var existing = this.remotes.find(function (remote) {
          return remote.id === senderId;
        });
        if (!existing) {
          var remote = { id: senderId, connection: null };
          this.remotes.push(remote);
          this.addPeerConnection(senderId);
          remote.connection.createOffer(function (sessionDescription) {
            _this2.signal('offer', {
              target: senderId,
              payload: sessionDescription
            });
            remote.connection.setLocalDescription(sessionDescription);
          }, function (err) {
            _this2.trigger(WebRTC.EVENT_ERROR, err);
          }, this.mediaConstraints);
        }
      }
    }, {
      key: 'signalLeave',
      value: function signalLeave(senderId) {
        var remoteIndex = this.remotes.findIndex(function (remote) {
          return remote.id === senderId;
        });
        if (remoteIndex !== -1) {
          this.remotes.splice(remoteIndex, 1);
        }
      }
    }, {
      key: 'signalIceCandidate',
      value: function signalIceCandidate(senderId, iceCandidate) {
        var existing = this.remotes.find(function (remote) {
          return remote.id === senderId;
        });
        if (iceCandidate.candidate && existing && existing.id === senderId) {
          existing.connection.addIceCandidate(new RTCIceCandidate({
            sdpMLineIndex: iceCandidate.label,
            candidate: iceCandidate.candidate
          }));
        }
      }
    }, {
      key: 'signalOffer',
      value: function signalOffer(senderId, offer) {
        var _this3 = this;

        var remoteIndex = this.remotes.findIndex(function (remote) {
          return remote.id === senderId;
        });
        if (remoteIndex !== -1) {
          this.remotes.splice(remoteIndex, 1);
        }
        var remote = { id: senderId, connection: null };
        this.remotes.push(remote);
        this.addPeerConnection(senderId);
        remote.connection.setRemoteDescription(new RTCSessionDescription(offer));
        remote.connection.createAnswer(function (sessionDescription) {
          remote.connection.setLocalDescription(sessionDescription);
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
        var existing = this.remotes.find(function (remote) {
          return remote.id === senderId;
        });
        if (existing) {
          existing.connection.setRemoteDescription(new RTCSessionDescription(answer));
        }
      }
    }, {
      key: 'addPeerConnection',
      value: function addPeerConnection(senderId) {
        var _this4 = this;

        var existing = this.remotes.find(function (remote) {
          return remote.id === senderId;
        });
        if (existing) {
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
                target: senderId
              });
            }
          };
          pc.onaddstream = function (event) {
            if (!pc.stream) {
              pc.stream = event.stream;
              _this4.trigger(WebRTC.EVENT_CONNECTED, event.stream);
            }
          };
          pc.ontrack = function (event) {
            if (!pc.stream) {
              pc.stream = event.streams[0];
              _this4.trigger(WebRTC.EVENT_CONNECTED, event.streams[0]);
            }
          };
          pc.onremovestream = function () {
            if (existing) {
              existing.connection = null;
              existing.remoteStreamURL = null;
            }
          };
          if (this.localStream) {
            pc.addStream(this.localStream);
          }
          pc.streamURL = '';
          pc.stream = '';
          existing.connection = pc;
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

  WebRTC.ROOM_TYPE_N_TO_N = 'n-to-n';
  WebRTC.ROOM_TYPE_1_TO_N = '1-to-n';

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
    urls: 'stun:148.251.126.74:5349'
  }, {
    urls: 'turn:148.251.126.74:5349',
    username: 'vl',
    credential: 'bfPB1VMy'
  }, {
    urls: 'stun:148.251.126.74:3478'
  }, {
    urls: 'turn:148.251.126.74:3478',
    username: 'vl',
    credential: 'bfPB1VMy'
  }, { urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:stun2.l.google.com:19302' }, { urls: 'stun:stun3.l.google.com:19302' }, { urls: 'stun:stun4.l.google.com:19302' }, { urls: 'stun:stun01.sipphone.com' }, { urls: 'stun:stun.ekiga.net' }, { urls: 'stun:stun.fwdnet.net' }, { urls: 'stun:stun.ideasip.com' }, { urls: 'stun:stun.iptel.org' }, { urls: 'stun:stun.rixtelecom.se' }, { urls: 'stun:stun.schlund.de' }, { urls: 'stun:stunserver.org' }, { urls: 'stun:stun.softjoys.com' }, { urls: 'stun:stun.voiparound.com' }, { urls: 'stun:stun.voipbuster.com' }, { urls: 'stun:stun.voipstunt.com' }, { urls: 'stun:stun.voxgratia.org' }, { urls: 'stun:stun.xten.com' }];

  exports.default = WebRTC;
});
