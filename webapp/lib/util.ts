function addSplitSymbol(str: string, symbol = '-'): string {
  var result = ''
  for (var i = 0; i < str.length; i++) {
    result += str.charAt(i);
    if ((i + 1) % 3 === 0 && i !== str.length - 1) {
      result += symbol
    }
  }
  return result
}

function delSplitSymbol(str: string, symbol = '-'): string {
  return str.replaceAll(symbol, '')
}

export {
  addSplitSymbol,
  delSplitSymbol,
}
