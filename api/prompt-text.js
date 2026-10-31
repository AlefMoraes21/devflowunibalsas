export function promptText(html){
 const entities={nbsp:' ',amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',ccedil:'ç',atilde:'ã',otilde:'õ',aacute:'á',eacute:'é',iacute:'í',oacute:'ó',uacute:'ú',agrave:'à',acirc:'â',ecirc:'ê',ocirc:'ô',uuml:'ü',ldquo:'“',rdquo:'”',lsquo:'‘',rsquo:'’',ndash:'–',mdash:'—'};
 return String(html??'').replace(/<\s*br\s*\/?\s*>/gi,'\n').replace(/<\/(p|h[1-6]|div)>/gi,'\n\n').replace(/<[^>]*>/g,'').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi,(whole,key)=>{
  if(key[0]==='#'){const number=key[1]?.toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1));return Number.isInteger(number)&&number>=0&&number<=0x10ffff&&!(number>=0xd800&&number<=0xdfff)?String.fromCodePoint(number):whole}
  const val=entities[key.toLowerCase()];return val?(key[0]===key[0].toUpperCase()?val.toUpperCase():val):whole;
 }).replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
}
