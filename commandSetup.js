const createCommandContext = (context) => ({
  ...context,
  say: async (text) => {
    // Log first, then send
    await MessageLogger.logBotMessage(context.channel, text);
    await bot.say(context.channel, text);
  }
});

