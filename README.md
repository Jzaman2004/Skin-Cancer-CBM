# Skin Cancer CBM

AI dermatology decision-support demonstration for the NRHC Roundtable Presentation Demo 2027. The project is a lightweight browser application that combines image analysis through Groq's vision API with a Firebase Realtime Database live submission feed.

## Overview

The application has one role-selection page:

- **Audience Member** opens the image-analysis workflow.
- **Developer / Admin** opens a split dashboard with the same analysis workflow on the left and the live audience submission feed on the right.

There is no login or password gate. The admin page is intended for the presentation demonstration.

## Pages

| Page | Purpose |
| --- | --- |
| `index.html` | Role selection and presentation landing page. |
| `audience.html` | Upload a skin-lesion image, add optional context, request an AI report, and save the submission. |
| `admin.html` | Run the same analysis workflow and monitor all saved audience submissions in real time. |

The admin page embeds `audience.html?embedded=admin` on its left side. The embedded mode hides the audience page's back button so the panel does not show a second navigation route.

## Analysis Workflow

1. Select an image in the audience or admin analysis panel.
2. The browser previews and compresses the image to a maximum dimension of 800 pixels.
3. Optional text is treated as **additional context**. It is appended to the default dermatology instructions, not used as a replacement.
4. The image and prompt are sent to Groq's OpenAI-compatible chat endpoint.
5. The `qwen/qwen3.6-27b` multimodal vision model returns a JSON report.
6. The report is displayed to the user and saved to Firebase under `submissions`.
7. The admin feed listens to Firebase and updates when new submissions arrive.

The expected report contains exactly these fields:

```json
{
	"primary_findings": ["Feature 1", "Feature 2"],
	"risk_interpretation": "Brief explanation of observed features",
	"recommendation": "Clinical recommendation",
	"confidence_level": "High/Moderate/Low"
}
```

The client requests JSON mode and disables model reasoning output. If a model response contains extra text, the browser extracts and stores only the JSON object when possible, so reasoning is not shown in the audience or admin report.

## Run Locally

The pages use CDN-hosted JavaScript libraries and do not require a build step.

```bash
python3 -m http.server 8000
```

Open [http://localhost:8000/](http://localhost:8000/) and choose a role.

Direct page URLs:

- [Audience workflow](audience.html)
- [Admin dashboard](admin.html)

Use an HTTP server instead of opening the files directly. This avoids browser restrictions around scripts, Firebase, and cross-page resources.

## Configuration

### Firebase

The Firebase project configuration is defined in both `audience.html` and `admin.html`. Both pages use the Firebase v9 compatibility SDK and Realtime Database.

Before using another Firebase project:

1. Create or select a Firebase project.
2. Enable Realtime Database.
3. Register a web app and copy its configuration into both pages.
4. Set Realtime Database rules appropriate for the intended audience. The demo requires clients to write submissions and the admin page to read them.

The app writes records like this:

```json
{
	"image": "data:image/jpeg;base64,...",
	"prompt": "Default instructions plus optional context",
	"response": "{\"primary_findings\": [...]} ",
	"timestamp": 1730000000000
}
```

Images are stored as base64 data in Realtime Database. This is convenient for a small demonstration but is not a scalable image-storage strategy.

### Groq

The Groq key and request configuration are defined in `audience.html`:

- Endpoint: `https://api.groq.com/openai/v1/chat/completions`
- Vision model: `qwen/qwen3.6-27b`
- Input: text prompt plus a base64 `image_url`
- Output: JSON mode with reasoning disabled

For a real deployment, do not place a Groq secret in client-side HTML. Move the Groq call to a server-side endpoint, keep the key in an environment variable such as `GROQ_API_KEY`, and have the browser call that endpoint instead.

## Troubleshooting

### Model over capacity

Groq may return an over-capacity error even for a single image because capacity is shared across users. Wait briefly and retry. The issue is service capacity, not necessarily the size or number of images sent.

### No live submissions appear

Check that:

- The Firebase configuration matches the active project.
- Realtime Database is enabled.
- Database rules allow the required read and write operations.
- The page is being served over HTTP, for example with `python3 -m http.server 8000`.
- The browser console does not show a Firebase initialization or network error.

### The report is not valid JSON

The app requests JSON mode and suppresses reasoning. If the model still returns an invalid response, retry the request and check the Groq response in the browser console. The interface avoids displaying unstructured model reasoning as a diagnostic report.

## Important Limitations

- This is a thesis/presentation demonstration, not a medical diagnosis tool.
- AI output must not replace examination by a qualified clinician.
- The current client-side API-key arrangement is not production-safe.
- The admin page has no authentication after the password gate was removed.
- Public Firebase write/read rules can expose submitted images and reports if configured broadly.
- Base64 image storage in Realtime Database is intended only for small demo traffic.