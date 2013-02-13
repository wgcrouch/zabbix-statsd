var exec = require('child_process').exec;

function ZabbixBackend(startupTime, config, emitter) {
  var self = this;
  this.lastFlush = startupTime;
  this.lastException = startupTime;
  this.config = config.zabbix || {};

  // a buffer for stats events
  this.statsBuffer = [];

  // a unique list of keys for discovery
  this.keys = {};

  // sender state to avoid multiple instances running
  this.senderRunning = false;

  // caches
  this.counters = {};
  this.timers = {};

  // attach
  emitter.on('flush', function(timestamp, metrics) { self.flush(timestamp, metrics); });
  emitter.on('status', function(callback) { self.status(callback); });
};

/**
 * flush() method called by statsd to flush out data each flushInterval
 */
ZabbixBackend.prototype.flush = function(timestamp, metrics) {
  var self = this;

  // gauges are simple
  for (var key in metrics.gauges) {
    this._storeData('gauge.'+ key, timestamp, metrics.gauges[key]);
  }

  // running totals are easier to handle in zabbix than diffs
  for (var key in metrics.counters) {
    if (!this.counters[key]) {
      this.counters[key] = 0;
    }
    this.counters[key] += metrics.counters[key];
    this._storeData('count.'+ key, timestamp, this.counters[key]);
  }

  // timer data
  for (var key in metrics.timers) {
    var timerData = this._getStats(metrics.timers[key]);
    for (var timer in timerData) {
      this._storeData('timer.'+ key +'.'+ timer, timestamp, timerData[timer]);
    }
  }

  // finally send all of the data back to the Zabbix server
  this._flushToZabbix();
};


/**
 * _sendToZabbix() sends all of the data in the statsFile via zabbix_sender
 * Would be nice to do this all in an async manner but this is so much easier
 */
ZabbixBackend.prototype._flushToZabbix = function() {

  var self=this;

  if (this.senderRunning) {
    console.log("zabbix_sender is already running");
    return false;
  }
  this.senderRunning = true;
  console.log(this.config.sender +" --config "+ this.config.config +" --with-timestamps --input-file -");
  var sender = exec(this.config.sender +" --config "+ this.config.config +" -T -i -",
    function (error, stdout, stderr) {
      if (error !== null) {
        console.log("Sender failed with: "+ error);
        console.log(stdout);
        console.log(stderr);
      }
      console.log(stdout);
      self.senderRunning=false;
    }
  );

  var bufferSize = this.statsBuffer.length;
  for (var i=0; i<bufferSize; i++) {
    console.log(this.statsBuffer[i]);
    sender.stdin.write(this.statsBuffer[i] +"\n");
  }
  sender.stdin.end();
  this.statsBuffer = [];
}

/**
 * _getStats() method used to extract min/max/avg from an array of ints
 */
ZabbixBackend.prototype._getStats = function(values) {
  var out = {};
  out.count = values.length;
  out.avg = out.max = out.min = 0;

  if (out.count > 0) {
    values = values.sort(function (a,b) { return a-b; });
    out.min = values[0];
    out.max = values[out.count - 1];

    var sum=0;
    for (var i=0; i<out.count; i++) {
      sum += values[i];
    }

    out.avg = sum / out.count;
  }
  return out;
};

/**
 * _storeData() writes data to a buffer before passing it to the
 * zabbix_sender process
 */
ZabbixBackend.prototype._storeData = function(key, data, timestamp) {
  var out = "- statsd["+ key +"] " +  data + " " + timestamp;
  this.statsBuffer.push(out);
  this.keys[key] = true;
};

/**
 * status() method pushes back a full list of seen keys to help with
 * the discovery process
 */
ZabbixBackend.prototype.status = function(writeCb) {
  writeCb(null, "zabbix", "keys", JSON.stringify(this.keys)); 
};

exports.init = function(startupTime, config, events) {
  var instance = new ZabbixBackend(startupTime, config, events);
  return true;
};
