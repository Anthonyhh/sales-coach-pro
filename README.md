# Sales Coach Pro

> AI-powered sales coaching platform that provides real-time guidance during live sales calls.

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL%203.0-blue.svg)](https://opensource.org/licenses/GPL-3.0)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)](https://github.com/salescoachpro/sales-coach-pro)

## Overview

Sales Coach Pro is an intelligent sales coaching assistant that listens to your sales calls in real-time and provides actionable coaching based on proven sales methodologies like BANT and MEDDIC. Get instant guidance on qualification, objection handling, closing techniques, and more—right when you need it.

### Key Features

- **Real-Time Sales Coaching**: AI analyzes your live sales calls and provides immediate tactical suggestions
- **BANT & MEDDIC Frameworks**: Built-in qualification coaching using industry-standard methodologies
- **Multiple Coaching Profiles**:
  - Sales Call Coach (General)
  - Discovery Call Specialist
  - Product Demo Coach
  - Objection Handling Expert
  - Deal Closing Tactics
  - Pricing Negotiation Strategy
- **Transparent Overlay Window**: Always-on-top coaching display that doesn't interfere with your video calls
- **Audio & Screen Analysis**: Understands both what's being said and what's on your screen (CRM data, presentations, etc.)
- **Cross-Platform**: Works on macOS, Windows, and Linux

## Quick Start

### Prerequisites

- Node.js 16+
- A Google Gemini API key ([Get one here](https://aistudio.google.com/apikey))

### Installation

```bash
# Clone the repository
git clone https://github.com/salescoachpro/sales-coach-pro.git
cd sales-coach-pro

# Install dependencies
npm install

# Start the application
npm start
```

### First-Time Setup

1. **Enter Your API Key**: Paste your Gemini API key when prompted
2. **Choose Your Profile**: Select the coaching profile that matches your call type (Discovery, Demo, Closing, etc.)
3. **Configure Audio**: Choose which audio sources to capture (prospect only, your voice only, or both)
4. **Position the Window**: Use keyboard shortcuts to place the coaching overlay where it won't obstruct your video

## How It Works

Sales Coach Pro captures your system audio and screen content, then uses Google Gemini's multimodal AI to provide contextual sales coaching:

1. **Listens to Conversations**: Captures audio from your sales calls via system audio routing
2. **Analyzes Visual Context**: Reads on-screen CRM data, presentations, and other relevant information
3. **Applies Sales Frameworks**: Evaluates conversations against BANT/MEDDIC qualification criteria
4. **Provides Tactical Coaching**: Suggests specific questions to ask, objections to address, and closing techniques

### Coaching Example

**Prospect says**: "That's more than we budgeted for."

**AI Coach suggests**:
> **Objection Detected: Budget**
> **Framework**: Acknowledge → Reframe to ROI
> **Say**: "I understand budget is a concern. Based on the inefficiency you mentioned with [their pain point], you're currently spending $X annually. Our solution pays for itself in [timeframe]. What would a 6-month payback period be worth to you?"

## Keyboard Shortcuts

| Action | Windows/Linux | macOS |
|--------|--------------|--------|
| Move Window | `Ctrl + Arrow Keys` | `Cmd + Arrow Keys` |
| Toggle Click-Through | `Ctrl + M` | `Cmd + M` |
| Toggle Visibility | `Ctrl + \` | `Cmd + \` |
| Ask Next Step | `Ctrl + Enter` | `Cmd + Enter` |
| Previous Response | `Ctrl + [` | `Cmd + [` |
| Next Response | `Ctrl + ]` | `Cmd + ]` |

## Configuration

### Audio Modes

- **Speaker Only (Prospect Audio)**: Captures only the prospect's voice for analysis
- **Microphone Only (My Voice)**: Captures only your responses
- **Both (Full Call)**: Captures the entire conversation for comprehensive coaching

### Coaching Profiles

Each profile is optimized for specific sales scenarios:

- **Sales Call Coach**: General live call coaching with BANT/MEDDIC qualification
- **Discovery Call**: Specialized for needs analysis and pain point discovery
- **Product Demo**: Value-focused demonstration coaching (features → outcomes)
- **Objection Handling**: Framework-based responses to common objections
- **Deal Closing**: Assumptive closing techniques and commitment strategies
- **Pricing Negotiation**: Tactics for protecting margins while closing deals

## Custom AI Instructions

Personalize the AI's coaching style by adding custom instructions:

```
Example: Focus on enterprise sales. Emphasize ROI over features.
Use consultative selling approach. Avoid being too aggressive.
```

## Building for Production

```bash
# Package for your platform
npm run package

# Create distributable installers
npm run make
```

## Privacy & Security

- **Local Processing**: All audio analysis happens on your machine
- **Bring Your Own API Key**: You control the AI provider and data flow
- **No Cloud Recording**: Audio is streamed to AI but not stored
- **Stealth Mode**: Invisible to screen sharing and recording software

## Roadmap

### Phase 2: Multi-AI Provider Support (Planned)
- Anthropic Claude integration
- OpenAI GPT-4 support
- Provider switching without restart

### Phase 3: Enhanced Integrations (Planned)
- Supabase authentication
- Twilio call recording
- Airtable CRM sync
- HubSpot/Salesforce connectors

### Phase 4: Web Widget (Planned)
- Browser-based coaching for web conferencing
- No desktop app required
- React + Tailwind UI

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

GPL-3.0 License - See [LICENSE](LICENSE) for details.

## Support

- **Documentation**: [salescoachpro.com/docs](https://salescoachpro.com/docs)
- **Support**: [salescoachpro.com/support](https://salescoachpro.com/support)
- **GitHub Issues**: [Report a bug](https://github.com/salescoachpro/sales-coach-pro/issues)

## Acknowledgments

Built on top of:
- [Electron](https://www.electronjs.org/) - Cross-platform desktop framework
- [Google Gemini 2.0 Flash](https://ai.google.dev/) - Multimodal AI with live audio/video
- [Lit Element](https://lit.dev/) - Lightweight web components

---

**Disclaimer**: Sales Coach Pro is a professional coaching tool designed to help sales representatives improve their skills. Use responsibly and in compliance with call recording laws in your jurisdiction. Always inform call participants when recording or using AI assistance.
