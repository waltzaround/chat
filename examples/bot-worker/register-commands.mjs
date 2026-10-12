// Registers this bot's slash commands. Run: CHAT_URL=https://chat.example.com BOT_TOKEN=... npm run register
const { CHAT_URL, BOT_TOKEN } = process.env;
if (!CHAT_URL || !BOT_TOKEN) throw new Error("Set CHAT_URL and BOT_TOKEN");

const commands = [
  { name: "roll", description: "Roll a die", usage: "[sides]" },
  { name: "poll", description: "Ask the channel a yes or no question", usage: "<question>" },
];

const res = await fetch(`${CHAT_URL}/api/bots/@me/commands`, {
  method: "PUT",
  headers: { Authorization: `Bot ${BOT_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify(commands),
});
console.log(res.status, await res.text());
