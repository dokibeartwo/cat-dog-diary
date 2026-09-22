import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {findNode,keyboardShown,launcherDialog}=createRequire(import.meta.url)('../scripts/ui-tree.cjs');
const text='<node text="这件事叫什么" class="android.widget.TextView" enabled="true" clickable="false" bounds="[10,20][80,40]" />';
const input='<node text="" content-desc="这件事叫什么" class="android.widget.EditText" enabled="true" clickable="true" bounds="[10,50][90,100]" />';
test('typing targets the editable input, never the earlier visible label',()=>{
  assert.equal(findNode(text+input,'这件事叫什么',{editable:true}),input);
  assert.equal(findNode(text,'这件事叫什么',{editable:true}),undefined);
});
test('disabled or zero-size UI controls are not tapped',()=>{
  assert.equal(findNode(input.replace('enabled="true"','enabled="false"'),'这件事叫什么'),undefined);
  assert.equal(findNode(input.replace('[10,50][90,100]','[0,0][0,0]'),'这件事叫什么'),undefined);
});
test('a real clickable control wins over its text label',()=>{
  const button=input.replace('android.widget.EditText','android.view.View');
  assert.equal(findNode(text+button,'这件事叫什么'),button);
});
test('Back is sent only while the software keyboard is actually shown',()=>{
  assert.equal(keyboardShown('mInputShown=true'),true);
  assert.equal(keyboardShown('isInputViewShown=true'),true);
  assert.equal(keyboardShown('mInputShown=false'),false);
  assert.equal(keyboardShown('mShowRequested=true'),false);
});
test('emulator workaround recognizes only the system launcher, never our app ANR',()=>{
  const title='<node text="Quickstep isn\'t responding" package="android" enabled="true" bounds="[0,0][100,40]" />';
  const close='<node text="Close app" package="android" enabled="true" bounds="[0,50][100,90]" />';
  assert.equal(launcherDialog(title+close),close);
  assert.equal(launcherDialog(title.replace('Quickstep','猫狗日记')+close),null);
  assert.equal(launcherDialog((title+close).replaceAll('package="android"','package="com.dokibeartwo.catdogdiary"')),null);
});
