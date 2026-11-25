# Sensei-Gogo

https://musankosi08.github.io/Sensei-Gogo/
 
A matric study assistant where an animated gogo explains Grade 12 CAPS questions step by step. She answers in the South African language you ask in, and can read questions from photos or Word files. No frameworks and no npm install.

## Run it
1. Install Node.js 18 or newer.
2. Create a GitHub fine-grained token with Models: Read-only permission.
3. Create a file named .env next to server.js, containing:

GITHUB_TOKEN=your_token_here

4. Start the server:
node server.js

5. Open http://localhost:3000.
   
## Files
- server.js: the Node server that talks to GitHub Models
- index.html: the whole app
- .env: your token. Never share or commit it.
