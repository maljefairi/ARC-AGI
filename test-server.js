const http = require('http');

const options = {
    hostname: 'localhost',
    port: 4000,
    path: '/',
    method: 'GET'
};

console.log('Testing server connection...');
console.log(`Trying to connect to http://localhost:${options.port}`);

const req = http.request(options, (res) => {
    console.log(`Status Code: ${res.statusCode}`);
    
    let data = '';
    res.on('data', (chunk) => {
        data += chunk;
    });
    
    res.on('end', () => {
        console.log('Response:', data);
        console.log('\nServer is working correctly!');
    });
});

req.on('error', (error) => {
    console.error('Error connecting to server:', error.message);
    console.log('\nPossible issues:');
    console.log('1. Server is not running - run: node server.js');
    console.log('2. Port 4000 is blocked');
    console.log('3. Firewall is blocking the connection');
});

req.end(); 