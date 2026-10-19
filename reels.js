let apiPromise;
function youtubeAPI(){
 if(window.YT?.Player)return Promise.resolve(window.YT);
 if(!apiPromise)apiPromise=new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>{apiPromise=null;reject(new Error('Guide service timed out'))},15000);
  window.onYouTubeIframeAPIReady=()=>{clearTimeout(timeout);resolve(window.YT)};
  const old=document.getElementById('youtube-api');if(old)old.remove();
  const script=document.createElement('script');script.id='youtube-api';script.src='https://www.youtube.com/iframe_api';script.onerror=()=>{clearTimeout(timeout);apiPromise=null;reject(new Error('Guide service unavailable'))};document.head.append(script);
 });return apiPromise;
}
const $=id=>document.getElementById(id);
const ICON={play:'<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10-6.5z" fill="currentColor" stroke="none"/></svg>',pause:'<svg viewBox="0 0 24 24"><path d="M8 5.5v13M16 5.5v13" stroke-width="2.4"/></svg>',muted:'<svg viewBox="0 0 24 24"><path d="M4 9.5h3l4.5-4v13l-4.5-4H4z"/><path d="m16 9.5 5 5m0-5-5 5"/></svg>',sound:'<svg viewBox="0 0 24 24"><path d="M4 9.5h3l4.5-4v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>'};
export class ReelPlayer{
 constructor({onPlaying,onError}){this.onPlaying=onPlaying;this.onError=onError;this.token=0;this.muted=true;this.enabled=false;this.userPaused=false;this.ready=false;this.playing=false;
  $('reel-play').onclick=()=>{if(!this.clip)return;if(this.playing){this.userPaused=true;this.player?.pauseVideo()}else{this.userPaused=false;this.enabled=true;if(this.ready)this.player.playVideo();else this.load(this.clip)}};
  $('reel-sound').onclick=()=>{this.muted=!this.muted;this.applySound()};$('reel-retry').onclick=()=>this.load(this.clip);
  this.interval=setInterval(()=>this.tick(),200);this.signal(false);this.applySound();
 }
 status(s){$('reel-status').textContent=s}
 signal(playing){this.playing=playing;this.onPlaying(playing);$('reel-play').innerHTML=playing?ICON.pause:ICON.play;$('reel-play').setAttribute('aria-label',playing?'Pause guide':'Play guide')}
 applySound(){if(this.ready){if(this.muted)this.player.mute();else this.player.unMute()}$('reel-sound').innerHTML=this.muted?ICON.muted:ICON.sound;$('reel-sound').setAttribute('aria-label',this.muted?'Turn guide sound on':'Turn guide sound off')}
 async load(clip){if(!clip)return;this.clip=clip;this.enabled=true;this.userPaused=false;this.failed=false;this.signal(false);$('reel-error').hidden=true;this.status('Loading guide…');$('reel-original').href=`https://www.youtube.com/watch?v=${clip.video}&t=${clip.start}s`;const token=++this.token;
  try{const YT=await youtubeAPI();if(token!==this.token||!this.enabled)return;
   if(this.ready){this.startClip();return}
   if(this.player)this.player.destroy();this.ready=false;
   if(!$('reel-player')){const mount=document.createElement('div');mount.id='reel-player';document.querySelector('.reel-video').append(mount)}
   this.player=new YT.Player('reel-player',{host:'https://www.youtube-nocookie.com',width:'100%',height:'100%',videoId:clip.video,playerVars:{autoplay:1,mute:1,playsinline:1,controls:1,rel:0,fs:0,start:clip.start,end:clip.end,origin:location.origin},events:{
    onReady:()=>{this.ready=true;this.player.getIframe().title='Follow-along stretching guide';if(this.enabled)this.startClip();else this.player.pauseVideo()},
    onStateChange:e=>this.state(e.data),onError:()=>this.fail(),onAutoplayBlocked:()=>{this.signal(false);this.status('Tap play to start');}
   }});this.watchdog=setTimeout(()=>{if(this.enabled&&!this.ready)this.fail()},18000);
  }catch(e){if(token===this.token)this.fail()}
 }
 startClip(){clearTimeout(this.watchdog);if(!this.enabled||!this.clip)return;this.applySound();this.player.loadVideoById({videoId:this.clip.video,startSeconds:this.clip.start,endSeconds:this.clip.end});this.status('Starting guide…');this.watchdog=setTimeout(()=>{if(this.enabled&&!this.playing&&!this.failed){this.status('Tap play to start');this.signal(false)}},8000)}
 state(value){if(!this.enabled){if(value===1)this.player?.pauseVideo();return}if(value===1){clearTimeout(this.watchdog);this.signal(true);this.status(`${this.clip.end-this.clip.start}s loop`);$('reel-error').hidden=true}else{this.signal(false);if(value===0&&!this.userPaused)this.replay();else if(value===2)this.status('Paused');else if(value===3)this.status('Buffering…')}}
 tick(){if(!this.enabled||!this.ready||!this.playing||!this.clip)return;const t=this.player.getCurrentTime();if(t>=this.clip.end-.15||t<this.clip.start-.5){this.player.seekTo(this.clip.start,true);this.player.playVideo()}}
 replay(){if(!this.clip)return;this.userPaused=false;if(!this.ready||this.failed){this.load(this.clip);return}this.enabled=true;this.player.seekTo(this.clip.start,true);this.player.playVideo()}
 fail(){clearTimeout(this.watchdog);this.failed=true;this.signal(false);this.status('Guide unavailable');$('reel-error').hidden=false;this.onError()}
 stop(){this.enabled=false;this.token++;clearTimeout(this.watchdog);this.signal(false);if(this.ready)this.player.pauseVideo();this.status('')}
 suspend(){this.suspended=this.enabled&&!this.userPaused;this.enabled=false;this.signal(false);if(this.ready)this.player.pauseVideo()}
 resume(){if(this.suspended){this.enabled=true;this.suspended=false;if(this.ready)this.player.playVideo();else this.load(this.clip)}}
}
