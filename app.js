// https://peteris.rocks/blog/dns-proxy-server-in-node-js-with-ui/

// NPM packages
var dns = require('native-dns');
var async = require('async');
var mdns = require('multicast-dns')();
var uuid = require('uuid').v4;
var NodeCache = require('node-cache');
//require('console-stamp')(console, {pattern: 'yyyy-mm-dd HH:MM:ss.l'});

// Local packages
var Config = require('./config');
console.log('config', Config);

// DNS server
var server = dns.createServer();

// Upstream authority
var authority = {
	address: Config.authority_ip,
	port: Config.authority_port,
	type: Config.authority_type
};

// Cache
var cache = new NodeCache();


// DNS server events
server.on('listening', function() {
	console.log('server listening on', server.address());
});

server.on('close', function() {
	console.log('server closed', server.address());
});

server.on('error', function(err, buff, req, res) {
	console.error(err.stack);
});

server.on('socketError', function(err, socket) {
	console.error(err);
});

server.on('request', handleRequest);

server.serve(Config.listen_port, Config.listen_ip);


// Handle mDNS responses
mdns.on('response', function(packet, rinfo) {
	// Return early if this isn't a response packet
	if(packet.type!='response')
		return;

	// Return early if there are no answers
	if(packet.answers.length==0)
		return;

	// Return early if the queue length is 0 (zero)
	if(queue.length==0)
		return;

	// Check the DNS queue if someone is waiting for a response
	// Loop through the queue
	Object.keys(queue).forEach(function(id) {
		var q = queue[id];

		// Loop through answers to see if one can answer our question
		packet.answers.forEach(function(answer) {
			// Return early if this is not a match
			if(answer.name.toLowerCase()!=q.question.name.toLowerCase())
				return;

			// Format the answer response
			var data = {
				name: answer.name,
				type: dns[answer.type],
				class: answer.class,
				ttl: answer.ttl
			};

			switch(answer.type.toUpperCase()) {
				case 'NS':
				case 'CNAME':
				case 'PTR':
					data.data = answer.data;
					break;
				default:
					data.address = answer.data;
			}

			// Prep the answer response
			q.response.answer.push(dns[answer.type](data));

			if(Config.verbose_mdns) console.log('mdns answer', data.data || data.address);
		});

		// Skip this record if we don't have any answers
		if(q.response.answer.length==0) {
			delete timers[id];
			delete queue[id];
			return;
		}

		// Store in the cache
		cache.set(q.question.name.toLowerCase(), q.response.answer, q.response.answer[0].ttl*1000);

		// If we've made it this far, we have answers!
		// Clear timeout to proxy
		clearTimeout(timers[id]);
		delete timers[id];

		// Send the response
		q.response.send();

		// Remove this item from the queue
		delete queue[id];
	});
});


// Handle a DNS request
var queue = {};
var timers = {};
function handleRequest(request, response) {
	var id = uuid();
	console.log('request from', request.address.address, 'for', request.question[0].name);

	// Check the cache
	var cached_data = cache.get(request.question[0].name.toLowerCase());
	if(typeof cached_data!='undefined') {
		if(Config.verbose_cache) console.log('returned cached data for', request.question[0].name);
		response.answer = cached_data;
		return response.send();
	}

	// If we're only to resolve local only, then if ANY of the questions are not for .local,
	// forward them all to upstream.  There's probably a graceful way to handle a mixed scenario,
	// but I'm not that graceful.
	var use_upstream_only = false;
	if(Config.local_only) {
		request.question.forEach(function(question) {
			if(!question.name.endsWith('.local'))
				use_upstream_only = true;
		});
	}

	// Build array of async functions for proxying
	var f = [];
	request.question.forEach(function(question) {
		// Do the real DNS look-up
		f.push(function(callback) {
			proxy(question, response, callback);
		});
	});


	// If we flagged to only resolve upstream, then only resolve upstream
	if(use_upstream_only) {
		async.parallel(f, function() {
			response.send();
		});

	// Otherwise, let's run it by locally first
	} else {
		// Push this question into our queue
		request.question.forEach(function(question) {
			queue[id] = {
				question: question,
				response: response
			}

			timers[id] = setTimeout(function() {
				if(Config.verbose_mdns) console.log(`mdns timeout`, question.name);
				async.parallel(f, function() {
					response.send();
				});
			}, Config.mdns_timeout);

			// Kick off the mDNS query
			mdns.query(question.name, function() {
				if(Config.verbose_mdns) console.log('mdns query', question.name);
			});
		});
	}
}


// Proxy a DNS query
function proxy(question, response, callback) {
	if(Config.verbose_proxy) console.log('proxying', question.name);

	var request = dns.Request({
		question: question,
		server: authority,
		timeout: Config.authority_timeout
	});

	request.on('message', function(err, msg) {
		msg.answer.forEach(function(a) {
			if(Config.verbose_proxy) console.log('dns answer', a);
			response.answer.push(a);
		});

		if(response.answer.length>0)
			cache.set(question.name.toLowerCase(), response.answer, response.answer[0].ttl*1000);
	});

	request.on('end', function() {
		callback();
	});

	request.send();
}
