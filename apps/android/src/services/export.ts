import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import {readReplica} from './local-db';
export async function exportLocalData():Promise<void>{
  if(!await Sharing.isAvailableAsync())throw Error('当前设备没有可用的文件分享功能');
  const target=`${FileSystem.cacheDirectory}cat-dog-diary-backup.json`;
  await FileSystem.writeAsStringAsync(target,JSON.stringify({format:'cat-dog-sync-v2',exportedAt:new Date().toISOString(),replica:readReplica()},null,2));
  await Sharing.shareAsync(target,{mimeType:'application/json',dialogTitle:'保存猫狗日记备份'});
}
