#include <Adafruit_NeoPixel.h>
// Match your wiring and strip length before uploading.
constexpr uint8_t LED_PIN = 6;
constexpr uint16_t LED_COUNT = 30;
Adafruit_NeoPixel strip(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);
String input;
float red=0, green=0, blue=0;
uint8_t targetR=60,targetG=75,targetB=70;
unsigned long lastMessage=0, lastFrame=0;
void setup(){ Serial.begin(115200);strip.begin();strip.setBrightness(55);strip.show(); }
void loop(){
 while(Serial.available()){
  char c=Serial.read();
  if(c=='\n'){
   input.trim();lastMessage=millis();
   if(input=="GREEN"){targetR=65;targetG=220;targetB=145;}
   else if(input=="AMBER"){targetR=245;targetG=170;targetB=45;}
   else if(input=="RED"){targetR=230;targetG=65;targetB=60;}
   else {targetR=60;targetG=75;targetB=70;}
   input="";
  }else if(input.length()<20)input+=c;
 }
 if(millis()-lastMessage>4000){targetR=60;targetG=75;targetB=70;}
 if(millis()-lastFrame>20){lastFrame=millis();red+=(targetR-red)*.07;green+=(targetG-green)*.07;blue+=(targetB-blue)*.07;strip.fill(strip.Color(red,green,blue));strip.show();}
}
