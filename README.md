# Project Luna: AI-Powered Twitch Bot

Project Luna is an advanced AI-driven Twitch bot designed to provide rich interactivity within Twitch streams. Leveraging cutting-edge technologies such as ES Modules, Winston for logging, Twurple for Twitch API interaction, and SQLite for persistence, Project Luna ensures consistency, scalability, and adherence to best practices.

## Features

- **Interactive Commands**: Responds to user commands like `#dice` and `#slap`.
- **Subscription Events**: Thanks subscribers, resubscribers, and gift subscriptions in real-time.
- **Modular Design**: Easily extendable with new commands and event handlers.
- **Secure Authentication**: Manages OAuth tokens with auto-refresh capabilities.
- **Logging**: Comprehensive logging using Winston.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v14 or higher)
- [SQLite](https://www.sqlite.org/index.html)
- Twitch account and [Twitch Developer Application](https://dev.twitch.tv/console/apps)

### Installation

1. **Clone the repository:**

   ```git clone https://github.com/yourusername/project-luna.git
   cd project-luna```

2. **Install dependencies:**

```npm install```

3. **Configure Environment Variables:**

Create a .env file in the root directory and populate it with your credentials. Refer to the provided .env example.

```cp .env.example .env```

4. **Initialize the Database:**

The database will be initialized automatically when the bot starts.

5. **Run the Bot:**

```npm start```

For development with automatic restarts:

```npm run dev```

**Contributing**
Contributions are welcome! Please open an issue or submit a pull request.

**License**
This project is licensed under the MIT License.