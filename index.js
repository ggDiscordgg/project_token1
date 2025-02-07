const express = require('express');
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const port = 3000;

// اتصال MongoDB
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log("✅ Connected to MongoDB"))
    .catch(err => console.error("❌ MongoDB Connection Error:", err));

// نماذج البيانات
const ServerSchema = new mongoose.Schema({
    serverId: String, 
    serverName: String, 
    description: String, 
    ownerId: String, 
    lastShared: Date,
    isFeatured: Boolean 
});
const Server = mongoose.model('Server', ServerSchema);

const ReportSchema = new mongoose.Schema({ serverId: String, reason: String, reporterId: String });
const Report = mongoose.model('Report', ReportSchema);

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

    new SlashCommandBuilder().setName('listservers').setDescription('اعرض قائمة السيرفرات المسجلة'),

    new SlashCommandBuilder().setName('report').setDescription('إبلاغ عن سيرفر مخالف')
        .addStringOption(option => option.setName('server_id').setDescription('معرف السيرفر').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('سبب الإبلاغ').setRequired(true)),

    new SlashCommandBuilder().setName('stats').setDescription('عرض إحصائيات السيرفر'),

    new SlashCommandBuilder().setName('share').setDescription('مشاركة سيرفرك مع الآخرين').addStringOption(option => option.setName('channel').setDescription('اسم القناة التي تود نشر السيرفر فيها').setRequired(true))
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

    // التحقق من أن المستخدم هو مالك البوت أو الأونر فقط
    if (interaction.commandName === 'setserver') {
        const serverName = interaction.options.getString('name');
        const description = interaction.options.getString('description');
        const existingServer = await Server.findOne({ serverId: interaction.guild.id });

        if (existingServer) {
            existingServer.serverName = serverName;
            existingServer.description = description;
            await existingServer.save();
        } else {
            const newServer = new Server({ serverId: interaction.guild.id, serverName, description, ownerId: interaction.user.id, lastShared: new Date() });
            await newServer.save();
        }
        await interaction.reply({ content: `✅ سيرفرك **${serverName}** تم تسجيله!`, ephemeral: true });
    }

    // تنفيذ أمر share
    if (interaction.commandName === 'share') {
        const channelName = interaction.options.getString('channel');
        const existingServer = await Server.findOne({ serverId: interaction.guild.id });

        // تحقق من وجود السيرفر في قاعدة البيانات
        if (!existingServer) {
            return interaction.reply({ content: '❌ لم يتم تسجيل سيرفرك بعد!', ephemeral: true });
        }

        // تحقق من الوقت الفعلي لنشر السيرفر
        const now = new Date();
        const timeDiff = now - existingServer.lastShared; // الفرق بين الوقت الحالي وآخر وقت نشر

        // إذا كانت الفترة أقل من 3 ساعات
        if (timeDiff < 3 * 60 * 60 * 1000) {
            const remainingTime = (3 * 60 * 60 * 1000 - timeDiff) / 1000; // الوقت المتبقي بالثواني
            return interaction.reply({ content: `❌ لا يمكنك نشر سيرفرك الآن. يمكنك المحاولة بعد ${Math.floor(remainingTime / 60)} دقيقة(s).`, ephemeral: true });
        }

        // نشر السيرفر في القناة المحددة
        const guild = client.guilds.cache.get(interaction.guild.id);
        if (!guild) {
            return interaction.reply({ content: '❌ لم أتمكن من العثور على السيرفر!', ephemeral: true });
        }

        const channel = guild.channels.cache.find(ch => ch.name === channelName);
        if (!channel) {
            return interaction.reply({ content: '❌ لم أتمكن من العثور على القناة المحددة!', ephemeral: true });
        }

        // تحقق إذا كانت القناة مفتوحة
        if (channel.permissionsFor(guild.members.me).has('SEND_MESSAGES') === false) {
            return interaction.reply({ content: '❌ القناة مغلقة. يرجى فتحها ليتم نشر السيرفر.', ephemeral: true });
        }

        // إرسال رسالة في القناة
        await channel.send(`🚀 **سيرفر جديد: ${existingServer.serverName}**\n${existingServer.description}\n🖱️ انضم عبر هذا الرابط: <رابط السيرفر>`);

        // الحصول على سيرفر عشوائي
        const randomServer = await Server.aggregate([{ $sample: { size: 1 } }]);
        const randomServerData = randomServer[0];
        if (randomServerData) {
            await channel.send(`💥 **سيرفر عشوائي:**\n**${randomServerData.serverName}**\n${randomServerData.description}\n🖱️ انضم عبر هذا الرابط: <رابط السيرفر العشوائي>`);
        }

        // تحديث وقت آخر نشر
        existingServer.lastShared = new Date();
        await existingServer.save();

        interaction.reply({ content: `✅ تم نشر سيرفرك بنجاح في القناة ${channelName}!`, ephemeral: true });
    }

    // تنفيذ أمر البلاغ
    if (interaction.commandName === 'report') {
        const serverId = interaction.options.getString('server_id');
        const reason = interaction.options.getString('reason');

        const report = new Report({ serverId, reason, reporterId: interaction.user.id });
        await report.save();

        // العثور على القناة الخاصة بالسيرفر بناءً على `serverId`
        const guild = client.guilds.cache.get(serverId);
        if (guild) {
            const reportChannel = guild.channels.cache.find(ch => ch.name === 'reports'); // هنا يتم التوجيه إلى قناة "reports"
            if (reportChannel) {
                reportChannel.send(`🚨 **بلاغ جديد عن سيرفر ${guild.name}:**\nسبب البلاغ: ${reason}\n📩 بواسطة: ${interaction.user.tag}`);
            }
        }

        interaction.reply({ content: '✅ تم إرسال الإبلاغ بنجاح!', ephemeral: true });
    }
});

// تسجيل الدخول
client.login(process.env.BOT_TOKEN);  

// تشغيل السيرفر
app.listen(port, () => console.log(`🚀 Server running at http://localhost:${port}`));