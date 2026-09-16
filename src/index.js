
require("dotenv").config();
const {
 Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
 PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder,
 ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder,
 TextInputStyle, EmbedBuilder
} = require("discord.js");
const Database = require("better-sqlite3");
const fs = require("fs");

fs.mkdirSync("./data",{recursive:true});
const db=new Database("./data/commission.sqlite");
db.pragma("journal_mode=WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS counters(guild_id TEXT PRIMARY KEY,next_number INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS tickets(
 id INTEGER PRIMARY KEY AUTOINCREMENT,guild_id TEXT,user_id TEXT,channel_id TEXT UNIQUE,
 seq INTEGER,order_id TEXT UNIQUE,category TEXT,size TEXT,description TEXT,
 status TEXT DEFAULT 'open',worker_id TEXT,created_at TEXT,closed_at TEXT
);
CREATE TABLE IF NOT EXISTS reviews(
 id INTEGER PRIMARY KEY AUTOINCREMENT,guild_id TEXT,user_id TEXT,order_id TEXT UNIQUE,
 worker_id TEXT,category TEXT,rating INTEGER,comment TEXT,created_at TEXT
)`);

const now=()=>new Date().toISOString();
const order=n=>`DZS-${String(n).padStart(4,"0")}`;
const getTicket=id=>db.prepare("SELECT * FROM tickets WHERE channel_id=?").get(id);
const getOrder=(g,o)=>db.prepare("SELECT * FROM tickets WHERE guild_id=? AND order_id=?").get(g,o);
const isStaff=m=>m && (m.permissions.has(PermissionFlagsBits.Administrator)||m.roles.cache.has(process.env.STAFF_ROLE_ID));
const categoryName=t=>t.size?`${t.category.toUpperCase()} ${t.size}`:t.category.toUpperCase();

const nextNumber=db.transaction(g=>{
 let r=db.prepare("SELECT next_number FROM counters WHERE guild_id=?").get(g);
 let n=r?r.next_number:1;
 if(r) db.prepare("UPDATE counters SET next_number=? WHERE guild_id=?").run(n+1,g);
 else db.prepare("INSERT INTO counters VALUES(?,?)").run(g,n+1);
 return n;
});

function panel(){
 return new EmbedBuilder().setTitle("🎨 DZS COMMISSION")
 .setDescription("Pilih jenis pembelian:\n\n🧑‍🎨 **SKIN** — 64 / 128 / 512\n🖼️ **RENDER**\n🎨 **LOGO**\n🎞️ **ANIMASI**\n\nNomor order otomatis: **DZS-0001**, **DZS-0002**, dst.")
 .setFooter({text:"DZS Commission System"});
}
function categoryMenu(){
 return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
 .setCustomId("category").setPlaceholder("🛒 Pilih jenis pembelian...")
 .addOptions(
  {label:"SKIN",description:"Minecraft Skin 64 / 128 / 512",value:"skin",emoji:"🧑‍🎨"},
  {label:"RENDER",description:"Minecraft / character render",value:"render",emoji:"🖼️"},
  {label:"LOGO",description:"Logo / branding",value:"logo",emoji:"🎨"},
  {label:"ANIMASI",description:"Animation commission",value:"animasi",emoji:"🎞️"}
 ));
}
function sizeMenu(){
 return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
 .setCustomId("size").setPlaceholder("🧑‍🎨 Pilih ukuran skin...")
 .addOptions(
  {label:"SKIN 64",description:"Minecraft skin 64×64",value:"64",emoji:"🟨"},
  {label:"SKIN 128",description:"Minecraft skin 128×128",value:"128",emoji:"🟨"},
  {label:"SKIN 512",description:"Minecraft skin 512×512",value:"512",emoji:"🟨"}
 ));
}
function ticketEmbed(t){
 const s={open:"🟢 Open",progress:"🟡 Progress",waiting:"🟠 Waiting",completed:"🟣 Completed"};
 return new EmbedBuilder().setTitle(`🎫 ${t.order_id}`)
 .setDescription(`**Pembelian:** ${categoryName(t)}\n**Customer:** <@${t.user_id}>\n**Status:** ${s[t.status]}\n**Worker:** ${t.worker_id?`<@${t.worker_id}>`:"Belum di-claim"}\n\n**Request / Detail:**\n${t.description}`)
 .setFooter({text:"DZS Commission System"});
}
function controls(){
 return [
  new ActionRowBuilder().addComponents(
   new ButtonBuilder().setCustomId("claim").setLabel("👨‍💻 Claim").setStyle(ButtonStyle.Primary),
   new ButtonBuilder().setCustomId("progress").setLabel("🟡 Progress").setStyle(ButtonStyle.Secondary),
   new ButtonBuilder().setCustomId("waiting").setLabel("🟠 Waiting").setStyle(ButtonStyle.Secondary),
   new ButtonBuilder().setCustomId("complete").setLabel("🟣 Completed").setStyle(ButtonStyle.Success)),
  new ActionRowBuilder().addComponents(
   new ButtonBuilder().setCustomId("close").setLabel("🔒 Close Ticket").setStyle(ButtonStyle.Danger))
 ];
}
function ratingButtons(o){
 return new ActionRowBuilder().addComponents(...[1,2,3,4,5].map(n=>
  new ButtonBuilder().setCustomId(`rate_${o}_${n}`).setLabel(`${n} ⭐`).setStyle(ButtonStyle.Primary)));
}

const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers]});
const commands=[
 new SlashCommandBuilder().setName("setup-commission").setDescription("Pasang panel commission."),
 new SlashCommandBuilder().setName("setup-feedback").setDescription("Pasang panel feedback."),
 new SlashCommandBuilder().setName("claim-ticket").setDescription("Claim ticket."),
 new SlashCommandBuilder().setName("order-status").setDescription("Ubah status ticket.")
  .addStringOption(o=>o.setName("status").setDescription("Status").setRequired(true)
   .addChoices({name:"Open",value:"open"},{name:"Progress",value:"progress"},{name:"Waiting",value:"waiting"},{name:"Completed",value:"completed"})),
 new SlashCommandBuilder().setName("close-ticket").setDescription("Selesaikan ticket."),
 new SlashCommandBuilder().setName("stats").setDescription("Statistik feedback."),
 new SlashCommandBuilder().setName("myfeedback").setDescription("Feedback saya.")
].map(x=>x.toJSON());

client.once("ready",async()=>{
 console.log(`Logged in as ${client.user.tag}`);
 try{
  const rest=new REST({version:"10"}).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID,process.env.GUILD_ID),{body:commands});
  console.log("Commands registered.");
 }catch(e){console.error(e);}
});

async function openOrder(i,cat,size){
 const modal=new ModalBuilder().setCustomId(`order_${cat}_${size||"none"}`).setTitle(`Order ${size?`SKIN ${size}`:cat.toUpperCase()}`);
 modal.addComponents(new ActionRowBuilder().addComponents(
  new TextInputBuilder().setCustomId("request").setLabel("Detail request")
  .setPlaceholder("Tulis detail commission kamu...")
  .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1500)));
 return i.showModal(modal);
}

async function createTicket(i,cat,size){
 const active=db.prepare("SELECT * FROM tickets WHERE guild_id=? AND user_id=? AND status!='completed'")
  .get(i.guildId,i.user.id);
 if(active)return i.reply({content:`❌ Kamu masih punya ticket aktif: <#${active.channel_id}> (${active.order_id}).`,ephemeral:true});
 const desc=i.fields.getTextInputValue("request");
 const seq=nextNumber(i.guildId), oid=order(seq), g=i.guild;
 const role=g.roles.cache.get(process.env.STAFF_ROLE_ID);
 const ch=await g.channels.create({
  name:`ticket-${oid.toLowerCase()}`,type:ChannelType.GuildText,parent:process.env.TICKET_CATEGORY_ID,
  topic:`${oid} | ${categoryName({category:cat,size})} | ${i.user.tag}`,
  permissionOverwrites:[
   {id:g.roles.everyone.id,deny:[PermissionFlagsBits.ViewChannel]},
   {id:i.user.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.AttachFiles]},
   ...(role?[{id:role.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.ManageMessages]}]:[])
  ]
 });
 db.prepare(`INSERT INTO tickets(guild_id,user_id,channel_id,seq,order_id,category,size,description,status,created_at)
 VALUES(?,?,?,?,?,?,?,?,?,?)`).run(g.id,i.user.id,ch.id,seq,oid,cat,size,desc,"open",now());
 const t=getTicket(ch.id);
 await ch.send({content:`<@${i.user.id}> ${role?`<@&${role.id}>`:""}`,embeds:[ticketEmbed(t)],components:controls()});
 const log=g.channels.cache.get(process.env.LOG_CHANNEL_ID);
 if(log) await log.send(`🎫 Order baru **${oid}** — ${categoryName(t)} — <@${i.user.id}>`);
 return i.reply({content:`✅ Ticket dibuat!\n🧾 **Order:** ${oid}\n🛒 **Pembelian:** ${categoryName(t)}\n🎫 <#${ch.id}>`,ephemeral:true});
}

async function claim(i){
 const t=getTicket(i.channelId); if(!t)return i.reply({content:"❌ Bukan ticket.",ephemeral:true});
 db.prepare("UPDATE tickets SET worker_id=? WHERE channel_id=?").run(i.user.id,i.channelId);
 await i.channel.send({embeds:[ticketEmbed(getTicket(i.channelId))]});
 return i.reply({content:`✅ Worker untuk ${t.order_id}: <@${i.user.id}>`,ephemeral:true});
}
async function closeTicket(i){
 const t=getTicket(i.channelId); if(!t)return i.reply({content:"❌ Bukan ticket.",ephemeral:true});
 db.prepare("UPDATE tickets SET status='completed',closed_at=? WHERE channel_id=?").run(now(),i.channelId);
 const u=getTicket(i.channelId);
 await i.channel.send({
  embeds:[new EmbedBuilder().setTitle(`✅ ${u.order_id} — Order Selesai`)
   .setDescription("Terima kasih sudah order! Customer, silakan pilih rating worker:")],
  components:[ratingButtons(u.order_id)]
 });
 if(!i.replied)await i.reply({content:`✅ ${u.order_id} selesai. Ticket akan dihapus dalam 60 detik.`,ephemeral:true});
 setTimeout(()=>i.channel.delete("DZS Commission completed").catch(()=>{}),60000);
}

client.on("interactionCreate",async i=>{
 try{
  if(i.isChatInputCommand()){
   if(["setup-commission","setup-feedback","claim-ticket","order-status","close-ticket"].includes(i.commandName)&&!isStaff(i.member))
    return i.reply({content:"❌ Khusus Admin/Staff.",ephemeral:true});
   if(i.commandName==="setup-commission")return i.reply({embeds:[panel()],components:[categoryMenu()]});
   if(i.commandName==="setup-feedback")return i.reply({embeds:[new EmbedBuilder().setTitle("💜 DZS FEEDBACK").setDescription("Feedback menampilkan **Worker, Reviewer, Rating, dan Review/Ulasan**.") ]});
   if(i.commandName==="claim-ticket")return claim(i);
   if(i.commandName==="order-status"){
    const t=getTicket(i.channelId);if(!t)return i.reply({content:"❌ Bukan ticket.",ephemeral:true});
    const s=i.options.getString("status");
    db.prepare("UPDATE tickets SET status=? WHERE channel_id=?").run(s,i.channelId);
    await i.channel.send({embeds:[ticketEmbed(getTicket(i.channelId))]});
    return i.reply({content:`✅ ${t.order_id} → **${s}**`,ephemeral:true});
   }
   if(i.commandName==="close-ticket")return closeTicket(i);
   if(i.commandName==="stats"){
    const r=db.prepare("SELECT COUNT(*) total,AVG(rating) avg FROM reviews WHERE guild_id=?").get(i.guildId);
    return i.reply({embeds:[new EmbedBuilder().setTitle("📊 DZS Feedback Stats").setDescription(`Total feedback: **${r.total}**\nRata-rata: **${r.avg?Number(r.avg).toFixed(2):"0.00"} ⭐**`)]});
   }
   if(i.commandName==="myfeedback"){
    const rows=db.prepare("SELECT order_id,category,rating,comment FROM reviews WHERE guild_id=? AND user_id=? ORDER BY id DESC LIMIT 10").all(i.guildId,i.user.id);
    return i.reply({content:rows.length?rows.map(x=>`**${x.order_id}** — ${x.category} — ${x.rating} ⭐\n${x.comment}`).join("\n\n"):"Belum ada feedback.",ephemeral:true});
   }
  }

  if(i.isStringSelectMenu()){
   if(i.customId==="category"){
    const c=i.values[0];
    if(c==="skin")return i.reply({content:"Pilih ukuran skin:",components:[sizeMenu()],ephemeral:true});
    return openOrder(i,c,null);
   }
   if(i.customId==="size")return openOrder(i,"skin",i.values[0]);
  }

  if(i.isButton()){
   if(["claim","progress","waiting","complete"].includes(i.customId)){
    if(!isStaff(i.member))return i.reply({content:"❌ Khusus staff/admin.",ephemeral:true});
    if(i.customId==="claim")return claim(i);
    const t=getTicket(i.channelId);if(!t)return i.reply({content:"❌ Bukan ticket.",ephemeral:true});
    const s={progress:"progress",waiting:"waiting",complete:"completed"}[i.customId];
    db.prepare("UPDATE tickets SET status=? WHERE channel_id=?").run(s,i.channelId);
    await i.channel.send({embeds:[ticketEmbed(getTicket(i.channelId))]});
    return i.reply({content:`✅ ${t.order_id} → **${s}**`,ephemeral:true});
   }
   if(i.customId==="close"){
    if(!isStaff(i.member))return i.reply({content:"❌ Khusus staff/admin.",ephemeral:true});
    return closeTicket(i);
   }
   if(i.customId.startsWith("rate_")){
    const p=i.customId.split("_"),oid=p[1],rating=Number(p[2]),t=getOrder(i.guildId,oid);
    if(!t||t.user_id!==i.user.id||t.status!=="completed")return i.reply({content:"❌ Rating tidak sesuai order kamu.",ephemeral:true});
    if(db.prepare("SELECT id FROM reviews WHERE order_id=?").get(oid))return i.reply({content:"❌ Order ini sudah diberi feedback.",ephemeral:true});
    const modal=new ModalBuilder().setCustomId(`review_${oid}_${rating}`).setTitle(`${oid} — ${rating} ⭐`);
    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("comment").setLabel("Review / Ulasan").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)));
    return i.showModal(modal);
   }
  }

  if(i.isModalSubmit()){
   if(i.customId.startsWith("order_")){
    const p=i.customId.split("_");return createTicket(i,p[1],p[2]==="none"?null:p[2]);
   }
   if(i.customId.startsWith("review_")){
    const p=i.customId.split("_"),oid=p[1],rating=Number(p[2]),t=getOrder(i.guildId,oid);
    if(!t||t.user_id!==i.user.id||t.status!=="completed")return i.reply({content:"❌ Order tidak valid.",ephemeral:true});
    if(db.prepare("SELECT id FROM reviews WHERE order_id=?").get(oid))return i.reply({content:"❌ Feedback sudah ada.",ephemeral:true});
    const comment=i.fields.getTextInputValue("comment");
    db.prepare(`INSERT INTO reviews(guild_id,user_id,order_id,worker_id,category,rating,comment,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(i.guildId,i.user.id,oid,t.worker_id,categoryName(t),rating,comment,now());
    const fc=i.guild.channels.cache.get(process.env.FEEDBACK_CHANNEL_ID);
    if(fc)await fc.send({embeds:[new EmbedBuilder().setTitle("💜 RATING WORKER")
      .setDescription(`━━━━━━━━━━━━━━\n👤 **Worker:** ${t.worker_id?`<@${t.worker_id}>`:"Belum ditentukan"}\n📋 **Reviewer:** <@${i.user.id}>\n⭐ **Rating:** ${"⭐".repeat(rating)}${"☆".repeat(5-rating)}\n💬 **Review/Ulasan:** "${comment}"\n🧾 **Order:** ${oid}\n🛒 **Commission:** ${categoryName(t)}\n━━━━━━━━━━━━━━`).setFooter({text:"DZS Commission System"}).setTimestamp()]});
    return i.reply({content:`✅ Feedback **${oid}** tersimpan!`,ephemeral:true});
   }
  }
 }catch(e){console.error(e);if(i.isRepliable()&&!i.replied)await i.reply({content:"❌ Error. Cek Deploy Logs.",ephemeral:true}).catch(()=>{});}
});
client.login(process.env.DISCORD_TOKEN);
