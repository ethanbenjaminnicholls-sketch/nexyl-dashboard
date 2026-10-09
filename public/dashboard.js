const express = require("express");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const {pool,getConfig,setConfig,getWarnings,getLogs} = require("./db");
const router = express.Router();
router.use(session({
  store:new pgSession({pool,tableName:"user_sessions",createTableIfMissing:true}),
  secret:process.env.SESSION_SECRET||"replace-this-secret",
  resave:false,saveUninitialized:false,
  cookie:{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",maxAge:7*24*60*60*1000}
}));
const api="https://discord.com/api/v10";
async function discordFetch(path,options={}) {
  const r=await fetch(api+path,options); const t=await r.text(); let d;
  try{d=JSON.parse(t)}catch{d=t}
  if(!r.ok) throw new Error(`Discord API returned ${r.status}`);
  return d;
}
function auth(req,res,next){if(!req.session.accessToken)return res.status(401).json({error:"Not authenticated"});next();}
function admin(g){return (BigInt(g.permissions||"0")&8n)===8n;}
async function manageable(token){
  const guilds=await discordFetch("/users/@me/guilds",{headers:{Authorization:`Bearer ${token}`}});
  const {client}=require("./bot");
  const installed=new Set(client.guilds.cache.map(g=>g.id));
  return guilds.filter(g=>admin(g)&&installed.has(g.id)).map(g=>({id:g.id,name:g.name,icon:g.icon,owner:!!g.owner}));
}
async function allowed(req,id){return (await manageable(req.session.accessToken)).some(g=>g.id===id);}
router.get("/auth/discord",(req,res)=>{
  const p=new URLSearchParams({client_id:process.env.DISCORD_CLIENT_ID,redirect_uri:process.env.DISCORD_REDIRECT_URI,response_type:"code",scope:"identify guilds"});
  res.redirect("https://discord.com/oauth2/authorize?"+p);
});
router.get("/auth/discord/callback",async(req,res)=>{
  try{
    if(!req.query.code)return res.status(400).send("Missing OAuth code.");
    const body=new URLSearchParams({client_id:process.env.DISCORD_CLIENT_ID,client_secret:process.env.DISCORD_CLIENT_SECRET,grant_type:"authorization_code",code:req.query.code,redirect_uri:process.env.DISCORD_REDIRECT_URI});
    const token=await discordFetch("/oauth2/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body});
    req.session.accessToken=token.access_token;
    req.session.save(()=>res.redirect("/dashboard.html"));
  }catch(e){console.error("OAuth error:",e);res.status(500).send("Discord login failed. Check OAuth settings.");}
});
router.get("/auth/logout",(req,res)=>req.session.destroy(()=>res.redirect("/")));
router.get("/api/me",auth,async(req,res)=>{
  try{res.json(await discordFetch("/users/@me",{headers:{Authorization:`Bearer ${req.session.accessToken}`} }));}
  catch{res.status(401).json({error:"Session expired"});}
});
router.get("/api/guilds",auth,async(req,res)=>{
  try{res.json(await manageable(req.session.accessToken));}
  catch(e){console.error(e);res.status(500).json({error:"Could not load servers"});}
});
router.get("/api/guild/:id/config",auth,async(req,res)=>{
  try{if(!await allowed(req,req.params.id))return res.status(403).json({error:"You cannot manage this server"});res.json(await getConfig(req.params.id));}
  catch(e){console.error(e);res.status(500).json({error:"Could not load config"});}
});
router.put("/api/guild/:id/config",auth,async(req,res)=>{
  try{if(!await allowed(req,req.params.id))return res.status(403).json({error:"You cannot manage this server"});res.json(await setConfig(req.params.id,req.body||{}));}
  catch(e){console.error(e);res.status(500).json({error:"Could not save config"});}
});
router.get("/api/guild/:id/warnings/:userId",auth,async(req,res)=>{
  try{if(!await allowed(req,req.params.id))return res.status(403).json({error:"You cannot manage this server"});res.json(await getWarnings(req.params.id,req.params.userId));}
  catch(e){res.status(500).json({error:"Could not load warnings"});}
});
router.get("/api/guild/:id/logs",auth,async(req,res)=>{
  try{if(!await allowed(req,req.params.id))return res.status(403).json({error:"You cannot manage this server"});res.json(await getLogs(req.params.id));}
  catch(e){res.status(500).json({error:"Could not load logs"});}
});
module.exports=router;
