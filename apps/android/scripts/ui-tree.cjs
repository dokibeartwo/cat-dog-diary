// Keep UI automation selectors separate so a label cannot masquerade as an input.
function findNode(tree, label, {editable = false, resourceId, packageName} = {}) {
  if (label == null && !resourceId) throw Error('A label or exact resource ID is required');
  const matches = (tree.replaceAll('&apos;',"'").match(/<(?:node|[A-Za-z_][\w.$]*\.[\w.$]+)\b[^>]*>/g) || []).filter(node => {
    if (!node.includes('enabled="true"')) return false;
    if (editable && !node.includes('class="android.widget.EditText"')) return false;
    if (packageName && !node.includes(`package="${packageName}"`)) return false;
    if (resourceId && !node.includes(`resource-id="${resourceId}"`)) return false;
    if (label != null && !node.includes(`text="${label}"`) && !node.includes(`content-desc="${label}"`)) return false;
    const bounds = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    return bounds && +bounds[3] > +bounds[1] && +bounds[4] > +bounds[2];
  });
  return matches.sort((a, b) => Number(b.includes('clickable="true"')) - Number(a.includes('clickable="true"')))[0];
}
function keyboardShown(dump) {
  return /\b(?:mInputShown|isInputViewShown|mIsInputViewShown)=true\b/.test(dump);
}
function launcherDialog(tree) {
  const title=findNode(tree,"Quickstep isn't responding"),close=findNode(tree,'Close app');
  return title?.includes('package="android"') && close?.includes('package="android"') ? close : null;
}
module.exports = {findNode, keyboardShown, launcherDialog};
