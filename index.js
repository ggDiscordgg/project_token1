const express = require('express');
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const mongoose = require('mongoose');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = 3000;

// اتصال MongoDBdf
console.log(process.env.MONGO_URI)
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log("✅ Connected to MongoDB"))
    .catch(err => console.error("❌ MongoDB Connection Error:", err));

// نماذج البيانات
const ServerSchema = new mongoose.Schema({ serverId: String, serverName: String, description: String, ownerId: String, isFeatured: Boolean });
const Server = mongoose.model('Server', ServerSchema);

const ReportSchema = new mongoose.Schema({ serverId: String, reason: String, reporterId: String });
const Report = mongoose.model('Report', ReportSchema);

const SuggestionSchema = new mongoose.Schema({ userId: String, suggestion: String, timestamp: Date });
const Suggestion = mongoose.model('Suggestion', SuggestionSchema);

// إعداد البوت
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.on('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
});

// أوامر السلاش
const commands = [
    new SlashCommandBuilder().setName('setserver').setDescription('تسجيل بيانات السيرفر')
        .addStringOption(option => option.setName('name').setDescription('اسم السيرفر').setRequired(true))
        .addStringOption(option => option.setName('description').setDescription('وصف السيرفر').setRequired(true)),

    new SlashCommandBuilder().setName('featured').setDescription('أضف سيرفرك إلى قائمة السيرفرات المميزة'),

    new SlashCommandBuilder().setName('listservers').setDescription('اعرض قائمة السيرفرات المسجلة'),

    new SlashCommandBuilder().setName('report').setDescription('إبلاغ عن سيرفر مخالف')
        .addStringOption(option => option.setName('server_id').setDescription('معرف السيرفر').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('سبب الإبلاغ').setRequired(true)),

    new SlashCommandBuilder().setName('stats').setDescription('عرض إحصائيات السيرفر'),

    new SlashCommandBuilder().setName('randomserver').setDescription('اقتراح سيرفر عشوائي'),

    new SlashCommandBuilder().setName('suggest').setDescription('إرسال اقتراح لتحسين السيرفر أو البوت')
        .addStringOption(option => option.setName('idea').setDescription('اكتب اقتراحك هنا').setRequired(true))
].map(command => command.toJSON());

// نشر الأوامر
const rest = new REST({ version: '9' }).setToken(process.env.BOT_TOKEN);
(async () => {
    try {
        console.log("🔄 Deploying commands...");
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
        console.log("✅ Commands deployed!");
    } catch (error) {
        console.error("❌ Error deploying commands:", error);
    }
})();

// تنفيذ الأوامر
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    if (interaction.commandName === 'setserver') {
        const serverName = interaction.options.getString('name');
        const description = interaction.options.getString('description');
        const existingServer = await Server.findOne({ serverId: interaction.guild.id });

        if (existingServer) {
            existingServer.serverName = serverName;
            existingServer.description = description;
            await existingServer.save();
        } else {
            const newServer = new Server({ serverId: interaction.guild.id, serverName, description, ownerId: interaction.user.id });
            await newServer.save();
        }
        await interaction.reply({ content: `✅ سيرفرك **${serverName}** تم تسجيله!`, ephemeral: true });
    }

    if (interaction.commandName === 'featured') {
        const server = await Server.findOne({ serverId: interaction.guild.id });
        if (!server) return interaction.reply({ content: '❌ سيرفرك غير مسجل! استخدم /setserver أولًا.', ephemeral: true });

        server.isFeatured = true;
        await server.save();
        interaction.reply({ content: `✅ سيرفرك **${server.serverName}** أصبح مميزًا!`, ephemeral: true });
    }

    if (interaction.commandName === 'listservers') {
        const servers = await Server.find();
        if (servers.length === 0) return interaction.reply({ content: '❌ لا يوجد سيرفرات مسجلة حتى الآن.', ephemeral: true });

        let response = '📌 **قائمة السيرفرات:**\n\n';
        servers.forEach(server => response += `🔹 **${server.serverName}** - ${server.description}\n`);
        interaction.reply({ content: response, ephemeral: false });
    }

    if (interaction.commandName === 'report') {
        const serverId = interaction.options.getString('server_id');
        const reason = interaction.options.getString('reason');

        const report = new Report({ serverId, reason, reporterId: interaction.user.id });
        await report.save();
        interaction.reply({ content: '✅ تم إرسال الإبلاغ بنجاح!', ephemeral: true });
    }

    if (interaction.commandName === 'stats') {
        const guild = interaction.guild;
        const stats = `📊 **إحصائيات سيرفرك:**\n👥 الأعضاء: ${guild.memberCount}\n📢 القنوات: ${guild.channels.cache.size}\n🎭 الأدوار: ${guild.roles.cache.size}`;
        interaction.reply({ content: stats, ephemeral: false });
    }

    if (interaction.commandName === 'randomserver') {
        const servers = await Server.find();
        if (servers.length === 0) return interaction.reply({ content: '❌ لا يوجد سيرفرات متاحة.', ephemeral: true });

        const randomServer = servers[Math.floor(Math.random() * servers.length)];
        interaction.reply({ content: `🔹 **${randomServer.serverName}** - ${randomServer.description}`, ephemeral: false });
    }

    if (interaction.commandName === 'suggest') {
        const idea = interaction.options.getString('idea');

        const newSuggestion = new Suggestion({ userId: interaction.user.id, suggestion: idea, timestamp: new Date() });
        await newSuggestion.save();

        const suggestionChannel = interaction.guild.channels.cache.find(ch => ch.name === 'suggestions');
        if (suggestionChannel) {
            suggestionChannel.send(`💡 **اقتراح جديد من ${interaction.user.tag}:**\n${idea}`);
        }

        interaction.reply({ content: '✅ تم إرسال اقتراحك بنجاح!', ephemeral: true });
    }
});

// تسجيل الدخول
client.login(process.env.BOT_TOKEN);

// واجهة تسجيل الدخول عبر Discord OAuth2
app.get('/login', (req, res) => {
    const authUrl = `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_type=code&scope=identify+guilds`;
    res.redirect(authUrl);
});

app.get('/callback', async (req, res) => {
    const code = req.query.code;

    try {
        const response = await axios.post('https://discord.com/api/oauth2/token', null, {
            params: {
                client_id: process.env.CLIENT_ID,
                client_secret: process.env.CLIENT_SECRET,
                code,
                grant_type: 'authorization_code',
                redirect_uri: process.env.REDIRECT_URI,
                scope: 'identify guilds'
            }
        });

        res.send(`<h1>✅ Login Successful!</h1><p>Now you can manage your server.</p>`);
    } catch (error) {
        res.send('❌ Error during authentication');
    }
});

// تشغيل السيرفر
app.listen(port, () => console.log(`🚀 Server running at http://localhost:${port}`));