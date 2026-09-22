import React,{useEffect,useState} from 'react';
import {Image,Modal,ScrollView,StyleSheet,Text,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Button,useTheme} from './ui';
import {getMeta,setMeta} from './services/local-db';
import type {Reminder} from './services/notifications';
const screens=[require('../assets/screens/screen1.png'),require('../assets/screens/screen2.png'),require('../assets/screens/screen3.png'),require('../assets/screens/screen4.png')];
export function ReminderScreen({reminder,busy,onAction}:{reminder:Reminder|null;busy:boolean;onAction:(action:'ack'|'snooze',complete?:boolean)=>void}) {
  const theme=useTheme(),[screen,setScreen]=useState(0);
  const identity=reminder?`${reminder.key}:${reminder.at}`:'';
  useEffect(()=>{
    if(!identity)return;
    const last=getMeta<{identity:string;index:number}>('reminder.screen',{identity:'',index:-1});
    if(last.identity===identity){setScreen(last.index);return;}
    const choices=[0,1,2,3].filter(i=>i!==last.index),index=choices[Math.floor(Math.random()*choices.length)]!;
    setScreen(index);setMeta('reminder.screen',{identity,index});
  },[identity]);
  return <Modal visible={!!reminder} animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={()=>{if(!busy)onAction('ack');}}>
    <View style={[s.fill,{backgroundColor:theme.colors.ink}]}>
      <Image source={screens[screen]} resizeMode="cover" blurRadius={22} style={[StyleSheet.absoluteFillObject,{width:'100%',height:'100%',opacity:0.5}]}/>
      <Image source={screens[screen]} resizeMode="contain" style={[StyleSheet.absoluteFillObject,{width:'100%',height:'100%',opacity:0.38}]}/>
      <SafeAreaView style={s.fill}><ScrollView contentContainerStyle={s.content}>
        <View style={{flex:1,justifyContent:'center',paddingVertical:28}}>
          <Text style={[s.label,{color:theme.colors.accent}]}>{reminder?.type==='deadline'?'截止提醒':reminder?.type==='focus'?'本轮结束':'猫狗日记提醒你'}</Text>
          <Text accessibilityRole="header" style={s.title}>{reminder?.title}</Text>
          <Text style={s.subtitle}>{reminder?new Date(reminder.at).toLocaleString():''}</Text>
          <Text style={s.subtitle}>先看见这一件，再从容地往前走。</Text>
        </View>
        <View style={[s.actions,{backgroundColor:theme.colors.canvas}]}>
          <Button title="我知道了" disabled={busy} onPress={()=>onAction('ack')}/>
          <Button secondary title="10 分钟后提醒" disabled={busy} onPress={()=>onAction('snooze')}/>
          {reminder?.type!=='focus'&&<Button title={reminder?.type==='habit'?'这次做到了 ✓':'完成这件事 ✓'} disabled={busy} onPress={()=>onAction('ack',true)}/>}
        </View>
      </ScrollView></SafeAreaView>
    </View>
  </Modal>;
}
const s=StyleSheet.create({fill:{flex:1},content:{flexGrow:1,padding:24},label:{fontSize:20,fontWeight:'800',textAlign:'center',marginBottom:20},title:{color:'#FFFFFF',fontSize:38,fontWeight:'900',textAlign:'center',lineHeight:50},subtitle:{fontSize:17,color:'#FFFFFF',textAlign:'center',marginTop:18},actions:{borderRadius:24,padding:16}});
