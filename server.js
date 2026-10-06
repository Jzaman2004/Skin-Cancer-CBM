const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const rootDirectory = __dirname;
const port = Number(process.env.PORT || 8000);

function loadLocalEnvironment() {
    const filePath = path.join(rootDirectory, ".env.local");
    if (!fs.existsSync(filePath)) return;

    for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
        if (!match || process.env[match[1]]) continue;
        process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
    }
}

loadLocalEnvironment();

function sendJson(response, statusCode, body) {
    response.writeHead(statusCode, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
}

function readRequestBody(request) {
    return new Promise((resolve, reject) => {
        let body = "";
        request.on("data", chunk => {
            body += chunk;
            if (body.length > 20 * 1024 * 1024) reject(new Error("Request is too large."));
        });
        request.on("end", () => resolve(body));
        request.on("error", reject);
    });
}

async function analyze(request, response) {
    if (!process.env.GROQ_API_KEY) {
        return sendJson(response, 500, { error: { message: "GROQ_API_KEY is missing from .env.local." } });
    }

    try {
        const payload = JSON.parse(await readRequestBody(request));
        const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.GROQ_API_KEY}`
            },
            body: JSON.stringify({
                model: "qwen/qwen3.8-27b",
                reasoning_effort: "none",
                messages: payload.messages,
                temperature: 0.3,
                max_tokens: 1000,
                response_format: { type: "json_object" }
            })
        });

        const result = await upstream.json();
        sendJson(response, upstream.status, result);
    } catch (error) {
        sendJson(response, 400, { error: { message: error.message } });
    }
}

function serveStatic(request, response, requestUrl) {
    const requestedPath = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
    const filePath = path.resolve(rootDirectory, `.${requestedPath}`);
    if (!filePath.startsWith(rootDirectory + path.sep)) return sendJson(response, 403, { error: "Forbidden" });

    fs.readFile(filePath, (error, content) => {
        if (error) return sendJson(response, 404, { error: "Not found" });
        const extension = path.extname(filePath);
        const contentTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
        response.writeHead(200, { "Content-Type": contentTypes[extension] || "application/octet-stream" });
        response.end(content);
    });
}

const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === "POST" && requestUrl.pathname === "/api/analyze") return analyze(request, response);
    if (request.method === "GET") return serveStatic(request, response, requestUrl);
    sendJson(response, 405, { error: "Method not allowed" });
});

server.listen(port, () => {
    console.log(`Local demo running at http://localhost:${port}`);
});