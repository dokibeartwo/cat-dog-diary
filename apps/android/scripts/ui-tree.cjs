// Keep UI automation selectors separate so a label cannot masquerade as an input.
function findNode(tree, label, {editable = false} = {}) {
  const matches = (tree.match(/<node\b[^>]*>/g) || []).filter(node => {
    if (!node.includes('enabled="true"')) return false;
    if (editable && !node.includes('class="android.widget.EditText"')) return false;
    if (!node.includes(`text="${label}"`) && !node.includes(`content-desc="${label}"`)) return false;
    const bounds = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    return bounds && +bounds[3] > +bounds[1] && +bounds[4] > +bounds[2];
  });
  return matches.sort((a, b) => Number(b.includes('clickable="true"')) - Number(a.includes('clickable="true"')))[0];
}
function keyboardShown(dump) {
  return /\b(?:mInputShown|isInputViewShown|mIsInputViewShown)=true\b/.test(dump);
}
module.exports = {findNode, keyboardShown};
