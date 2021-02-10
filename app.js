// https://peteris.rocks/blog/dns-proxy-server-in-node-js-with-ui/

// NPM packages
var dns = require('native-dns');
var async = require('async');
var mdns = require('multicast-dns')();
require('console-stamp')(console, {pattern: 'yyyy-mm-dd HH:MM:ss.l'});

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
	if(dns_queue.length==0)
		return;

	// Check the DNS queue if someone is waiting for a response
	// Loop through the queue
	for(var i=0; i<dns_queue.length; i++) {
		var queue = dns_queue[i];

		// Loop through answers to see if one can answer our question
		packet.answers.forEach(function(answer) {
			// Return early if this is not a match
			if(answer.name.toLowerCase()!=queue.question.name.toLowerCase())
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
			queue.response.answer.push(dns[answer.type](data));
		});

		// Skip this record if we don't have any answers
		if(queue.response.answer.length==0)
			continue;

		// If we've made it this far, we have answers!
		// Clear timeouts to proxy
		clearTimeout(queue.timeout);
		clearTimeout(dns_queue[i].timeout);

		// Send the response
		queue.response.send();

		// Remove this item from the queue
		dns_queue.splice(i, 1);
	}
});


// Handle a DNS request
var dns_queue = [];
function handleRequest(request, response) {
	console.log('request from', request.address.address, 'for', request.question[0].name);

	// Build array of async functions for proxying
	var f = [];
	request.question.forEach(function(question) {
		// Do the real DNS look-up
		f.push(function(callback) {
			proxy(question, response, callback);
		});
	});

	// Push this question into our queue
	request.question.forEach(function(question) {
		dns_queue.push({
			question: question,
			response: response,
			// A timer so we don't time out waiting on an mDNS response
			timeout: setTimeout(function() {
					console.log('timeout');
					async.parallel(f, function() {
						response.send();
					});
				}, Config.mdns_timeout)
		});

		// Kick off the mDNS query
		mdns.query(question.name, function() {
			console.log('mdns query', question.name);
		});
	});
}


// Proxy a DNS query
function proxy(question, response, callback) {
	console.log('proxying', question.name);

	var request = dns.Request({
		question: question,
		server: authority,
		timeout: Config.authority_timeout
	});

	request.on('message', function(err, msg) {
		msg.answer.forEach(function(a) {
			console.log('dns answer', a);
			response.answer.push(a);
		});
	});

	request.on('end', callback);
	request.send();
}
