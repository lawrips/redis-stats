'use strict';

const Redis = require('ioredis'),
    debug = require('debug')('redis-stats');

let internals = {};

const prefix = 'status:';
const cleanupInterval = 300;

class RedisStats {
    constructor(options) {
        // required
        if (!options.servers) {
            throw new Error('RedisStats constructor requires "servers" parameter in options to start. Format: [{host: host, port:port}] ');    
        }
        if (!options.stats) {
            throw new Error('RedisStats constructor requires "stats" parameter in options to start. e.g. [\'used_memory\', \'uptime_in_seconds\'] ');    
        }
        this.servers = options.servers;
        this.redisOptions = options.redisOptions || {};
        this.stats = options.stats;

        // if prefix is set, use it here (otherwise go with default)
        this.prefix = options.prefix || prefix;
        
        // if cluster option is set, use it here, otherwise default is false
        this.cluster = options.cluster || false;

        // optional
        this.interval = options.interval || 60; // default is 60s
        this.maxItems = options.maxItems || 1440; // default is 1 day of timings (assuming 60s interval)
        this.maxItemsHourly = options.maxItemsHourly || 48; // default is 2 days of timings 
        this.maxItemsDaily = options.maxItemsDaily || 30; // default is 30 days of timings 

        // the set of servers to be monitored
        this.redises = [];        
        this.servers.forEach((server) => {
            let redisOptions = JSON.parse(JSON.stringify(this.redisOptions));
            redisOptions.host = server.host;
            redisOptions.port = server.port;

            this.redises.push(new Redis(redisOptions));
        });

        // if cluster param was passed in, we use this for writing status back
        if (this.cluster) {
            this.cluster = new Redis.Cluster(this.servers, 
            {
                redisOptions: this.redisOptions
            });
        }

    }

    initialize() {
        // insert data every specified number of seconds
        setInterval(() => {
            this._updateStatus();
        }, this.interval * 1000);

        // cleanup every 5 minutes
        setInterval(() => {
            this._cleanupStatus();
        }, cleanupInterval * 1000);
    }

    _cleanupStatus() {
        this.redises.forEach((redis) => {
            this.stats.forEach((statusItem) => {
                let redisServer;
                if (this.cluster) {
                    redisServer = this.cluster; 
                }
                else {
                    redisServer = redis;
                }

                // e.g. "status:127.0.0.1:6379:used_memory"
                let key = this.prefix + redis.options.host + ':' + redis.options.port + ':' + statusItem;
                internals.removeFromZsets(redisServer, key, this.maxItems);

                // e.g. "status:127.0.0.1:6379:daily:used_memory"
                key = this.prefix + redis.options.host + ':' + redis.options.port + ':daily:' + statusItem;
                internals.removeFromZsets(redisServer, key, this.maxItemsDaily);

                // e.g. "status:127.0.0.1:6379:hourly:used_memory"
                key = this.prefix + redis.options.host + ':' + redis.options.port + ':hourly:' + statusItem;
                internals.removeFromZsets(redisServer, key, this.maxItemsHourly);

            }); 
        });

    }

    _updateStatus() {
        this.redises.forEach((redis) => {
            redis.info((err, result) => {
                // future emit an event
                if (err) debug(err);

                // e.g. ['used_memory','100mb']
                let statuses = internals.renderStatus(result);
                for (let status of statuses) {                
                    if (!status[1]) continue; // this will occur only for headers (e.g. # Server)

                    // extra loop to deal with cases like {"db0":"keys=100,avg_ttl=100"}
                    for (let statusItem of status[1].split(',')) {
                        // in the case of {"db0":"keys=100,avg_ttl=100"}, statusKey will be set to db0:keys 
                        let statusKey = statusItem.split('=').length > 1 ? status[0] + ':' + statusItem.split('=')[0] : status[0];

                        // in the case of {"db0":"keys=100,avg_ttl=100"}, statusVal will be set to 100 
                        let statusVal = statusItem.split('=').length > 1 ? statusItem.split('=')[1] : statusItem;

                        // if the current key matches a key we want to track 
                        if (this.stats.indexOf(statusKey) > -1) {

                            // e.g. "status:127.0.0.1:6379:used_memory"
                            let key = this.prefix + redis.options.host + ':' + redis.options.port + ':' + [statusKey] ;                        
                            let time = new Date();                        
                            let obj = {};
                            // e.g. {'2016-09-10T10:00:00.000Z' : '100mb'}                        
                            obj[time.toISOString()] = statusVal;

                            internals.addToZsets(this.cluster || redis, key, time.getTime(), obj);
                        
                            // e.g. "status:127.0.0.1:6379:hourly:used_memory"
                            key = this.prefix + redis.options.host + ':' + redis.options.port + ':hourly:' + [statusKey];
                            var hourTime = time.toISOString().slice(0,13) + ':00:00.000Z';
                            internals.addAvgToZsets(this.cluster || redis, key, new Date(hourTime).getTime(), hourTime, Number.parseFloat(statusVal));                    

                            // e.g. "status:127.0.0.1:6379:daily:used_memory"
                            key = this.prefix + redis.options.host + ':' + redis.options.port + ':daily:' + [statusKey];
                            var dayTime = time.toISOString().slice(0,10) + 'T00:00:00.000Z';
                            internals.addAvgToZsets(this.cluster || redis, key, new Date(dayTime).getTime(), dayTime, Number.parseFloat(statusVal));                    
                        }
                    };
                }
            }); 
        });    
    }

}

internals.removeFromZsets = function(redisServer, key, maxItems) {
    redisServer.zcard(key, (err, count) => {  
        if (err) return debug(err);
        debug('number of items in set ' + key + ' is ' + count);
        if (count > maxItems) {
            debug('Removing ' + (count - maxItems) + ' items');
            redisServer.zremrangebyrank(key, 0, count - maxItems - 1, (err, result) => {
                if (err) return debug(err);
                debug('Removed ' + result + ' items from ' + key);                                
            });
        }
    });                                                                        
}

internals.addToZsets = function(redisServer, key, score, obj) {
    // e.g.  "status:127.0.0.1:6379:used_memory", "now (in ms)", "{'now (in ISO)':'100mb'}'"
    redisServer.zadd(key, score, JSON.stringify(obj));
    debug('added object ' + JSON.stringify(obj) + ' to set ' + key);
}

internals.addAvgToZsets = function(redisServer, key, score, objKey, objVal) {
    redisServer.zrangebyscore(key, score, score, (err, result) => {
        // e.g.  "status:127.0.0.1:6379:used_memory", "now (in ms)", "{'now (in ISO)':'100mb'}'"
        if (err) return debug(err); 
        if (!result || result.length == 0) {
            let obj = {n: 1};
            // '1' is the count (# of times this value has been udpated this hour)
            obj[objKey] = objVal;
            redisServer.zadd(key, score, JSON.stringify(obj));
            debug('added object ' + JSON.stringify(obj) + ' to set ' + key + ' with score ' + score);
        }
        else {
            result = JSON.parse(result[0]);
            let obj = {};
            // n will be the key, or the # of times this value has been updated this hour            
            let n = result.n;

            let newVal = (n * result[objKey] + objVal) / (n+1);
            obj[objKey] = newVal;
            obj['n'] = n+1;
            redisServer.zremrangebyscore(key, score, score);
            redisServer.zadd(key, score, JSON.stringify(obj));
            debug('updated object ' + JSON.stringify(obj) + ' to set ' + key + ' with score ' + score);
        }
    });
}

internals.renderStatus= function(status){
    let lines = status.split('\n');
    let table = [];
    lines.forEach((line) => {
        if (line) {
            let pair = line.split(':');
            let obj = [];
            obj.push(pair[0]);
            obj.push(pair[1] ? pair[1].replace('\r','') : null);
            table.push(obj);
        }
    });
    
    return table;
}

module.exports = RedisStats;