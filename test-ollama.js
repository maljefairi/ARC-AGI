const fetch = require('node-fetch');

async function testOllama() {
    try {
        console.log('Testing Ollama connection...');
        
        const response = await fetch('http://localhost:11434/api/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'llava',
                prompt: 'Hello, are you working?',
                stream: false // Set to false for simpler response handling
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.text(); // Get raw response text first
        console.log('Raw response:', data);

        try {
            const jsonData = JSON.parse(data);
            console.log('Parsed response:', jsonData);
        } catch (parseError) {
            console.error('JSON parse error:', parseError);
            console.log('Response was not valid JSON');
        }
    } catch (error) {
        console.error('Error:', error.message);
        if (error.code === 'ECONNREFUSED') {
            console.log('Make sure Ollama is running on port 11434');
        }
    }
}

testOllama(); 