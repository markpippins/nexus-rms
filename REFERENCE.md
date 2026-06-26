# Nebula UI — Reference Guide

## Configuration

| Property | Default | Description |
|----------|---------|-------------|
| `API_KEY` | — | Google Gemini API key (required for AI features) |
| `NEBULA_API_URL` | http://localhost:3101 | Nebula backend API URL |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `API_KEY` | — | Gemini API key (set via UI or env) |
| `NEBULA_API_URL` | http://localhost:3101 | Backend API base URL |

## Commands

| Command | Description |
|---------|-------------|
| `npm start` | Start Angular dev server |
| `npm run build` | Build for production |
| `npm test` | Run unit tests |

## Troubleshooting

- **AI generation not working**: Click Setup AI in the toolbar and enter a valid Gemini API key — the key must have access to the Gemini 2.5 Flash model
- **Data not persisting**: All data is stored in localStorage — check that localStorage is not full or disabled in the browser
- **UI not loading**: Clear the browser cache and reload — Angular 21 zoneless mode requires a modern browser
- **Dark mode not toggling**: Theme preference is persisted in localStorage — clear site data to reset
