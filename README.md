mdns-resolver-forwarder
=======================

NodeJS script that acts as a DNS resolver/forwarder but checks mDNS first.  This was written to act as a DNS resolver for Docker containers that can't resolve mDNS addresses (`*.local`) on their own.


Config
------

Edit `config.js`:
 - `listen_ip` - IP address on the host to bind to
 - `listen_port` - Port number on the host to bind to (probably port `53` for most cases)
 - `authority_ip` - IP address of the resolver to use if local mDNS lookup fails
 - `authority_port` - Port number of the `authority_ip` above
 - `authority_type` - The DNS query type to use (probably `udp` for most cases)
 - `authority_timeout` - Timeout to wait on the authority to respond
 - `mdns_timeout` - Time to wait for mDNS to response before forwarding the query to the authority/resolver
 - `local_only` - Only listen for `*.local` domains.  Setting this to `true` will instantly forward any request that contains non-`.local` domains to the resolver (for faster response)
