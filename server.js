import http from 'node:http';
import flowHandler,{workerHandler} from './api/flow.js';

const port=Number(process.env.PORT||8080);
const server=http.createServer(async(req,res)=>{
  res.status=(code)=>{res.statusCode=code;return res};
  res.send=(body)=>res.end(body);
  res.json=(body)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body))};
  if(req.url==='/'||req.url==='/healthz')return res.status(200).json({status:'ok'});
  if(!['/api/flow','/internal/flow-worker'].includes(req.url?.split('?')[0]))return res.status(404).send('Not found');
  try{
    if(req.method==='POST'){
      const parts=[];let size=0;
      for await(const part of req){size+=part.length;if(size>1048576)return res.status(413).send('Payload too large');parts.push(part)}
      req.rawBody=Buffer.concat(parts);
      try{req.body=JSON.parse(req.rawBody.toString('utf8'))}catch{return res.status(400).send('Invalid JSON')}
    }
    if(req.url?.split("?")[0]==="/internal/flow-worker"){if(req.method!=="POST")return res.status(405).send("");await workerHandler(req,res)}else await flowHandler(req,res);
  }catch(error){
    console.error('HTTP handler failed:',error.name);
    if(!res.headersSent)res.statusCode=500;
    if(!res.writableEnded)res.end();
  }
});
server.listen(port,'0.0.0.0',()=>console.log(`Servidor ouvindo na porta ${port}`));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
