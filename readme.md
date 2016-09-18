# redis-stats
Automatic generation of stats using the redis INFO command

```javascript
var RedisStats = require('redis-stats');

var redisStats = new RedisStats({
    servers: [{'host': 'localhost', 'port': 6379}],
    stats: ['uptime_in_seconds','used_memory'],
});

redisStats.initialize();
```

## How it works
Include and initialize this library to automatically take snapshots of your redis server(s) using the rediS INFO command. By having these stats automatically generated in the background, it becomes easy to create graphs on memory usage, # connected clients, uptime, changes since last backup, etc. 

The INFO stats are persisted in the same Redis instance(s) as those being monitored. 

## Usage
To initialize Redis-Stats, use the minimum setup:

```javascript
var RedisStats = require('redis-stats');

var redisStats = new RedisStats({
    servers: [{'host': 'localhost', 'port': 6379}],
    stats: ['uptime_in_seconds','used_memory'],
});

redisStats.initialize();
```

### Output
As stats are collected, they are stored back in Redis in a ZSET.

Each server + statistic combo will form its own zset. Three sets are created for each stat:

1. Raw measurements which will be a list of every recording
2. Hourly averages
3. Daily averages 

The format of the zset keys for each of these formats is:

```
<prefix>:<server>:<port>:<statistic> (RAW) and
<prefix>:<server>:<port>:hourly:<statistic> (hourly)
<prefix>:<server>:<port>:daily:<statistic> (daily)
```

For example:

```
status:127.0.0.1:6379:used_memory (for RAW entries)
status:127.0.0.1:6379:hourly:used_memory (for hourly averages)
status:127.0.0.1:6379:daily:used_memory (for daily averages) 
```

Within each zset, the entries are ranked by time inserted (i.e. new Date().getTime()) in descending order and take the format:

```
{'<date_in_iso_format>':'<value_of_statistic'>}
```

Data is stored in "stringified" format. 

For example, the ZSET status:127.0.0.1:6379:used_memory might have the following RAW entries if the sampling rate was every 60 seconds:

```
1) "{\"2016-09-18T00:40:36.788Z\":\"19927984\"}"
2) "{\"2016-09-18T00:41:40.603Z\":\"19928848\"}"
3) "{\"2016-09-18T00:42:40.960Z\":\"19918992\"}"
``` 

The format for the hourly ZSET is similar. For example, for the ZSET status:127.0.0.1:6379:hourly:used_memory, we might see the following:

```
1) "{\"2016-09-17T21:00:00.000Z\":19840866.461538456,\"n\":60}"
2) "{\"2016-09-17T22:00:00.000Z\":19800674.533333343,\"n\":60}"
3) "{\"2016-09-17T23:00:00.000Z\":19813061.066666666,\"n\":60}"
``` 

Where n is the number of samples taken to create the average. This is only used in calculation and not generally useful for display purposes, so can be binned.

Daily, as you'd expect is:

```
1) "{\"2016-09-16T00:00:00.000Z\":19897914.94736842,\"n\":1440}"
1) "{\"2016-09-17T00:00:00.000Z\":19255914.94736842,\"n\":1440}"
1) "{\"2016-09-18T00:00:00.000Z\":29235914.94736842,\"n\":1440}"
```

### Displaying Stats
You can consume this data yourself easily by just querying redis directly.

In javascript:

```javascript
redis.zrangebyscore('status:' + host + ':' + port + ':' + type, '-inf', '+inf', (err, results) => {
    console.log('all my stats:' + results);
    // You can use JSON.parse(results) to get access to the data in object format 
});                
```

Querying redis directly:
```
ZRANGEBYSCORE "status:127.0.0.1:6379:used_memory" -inf +inf
```

Alternatively, I'm writing a separate reactjs library which will turn these stats into charts (using the lovely chartjs).

[Find out more at Redis-Live](https://www.npmjs.com/package/redis-live). 

### Options
The full list of options accepted by the Redis-Stats constructor:

```js
{
    servers: [{'host':'host', 'port':'port'}],  // array of servers to be monitored   
    stats: ['uptime_in_seconds','used_memory'],   // list of stats to monitor - full list is here http://redis.io/commands/INFO
    redisOptions : {},  // (optional) standard redis options (e.g. 'password')
    prefix: 'myserverstats:',    // (optional) prefix to insert in front of keys in redis for any persisted stats 
    cluster: true,      // (optional) if true, the supplied redis servers will be treated as a cluster. If false (default), they'll be treated as independent servers      
    interval: 30,  // (optional) how long in seconds to wait between each redis INFO command (default is 60)
    maxItems:  5400     // (optional) how many items to persist for each server:stat combo (default is 1440 which is 1 days worth of stats at 1 minute intervals)
}
```


### Debugging

To see debug logs as they are generated, simply set the environment variable:

```
DEBUG=redis-stats
``` 

### Next steps
A bunch of todos:

1. Tests!
2. ~~More time slicing options (e.g. bucketing by hour, etc)~~ 
3. Event emitting for errors (e.g. connection failed to redis, etc)
4. More display options (which will be in other libraries like redis-live)
