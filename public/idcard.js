/* 身份证号解析：出生日期 / 年龄 / 性别
 * 18 位按 GB 11643 校验位算法校验；兼容 15 位老身份证
 */
(function (root) {
  var WEIGHT = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  var CHECK = '10X98765432';

  function parseIdCard(raw) {
    var s = String(raw == null ? '' : raw).trim().toUpperCase();
    var birth = '', valid = false;

    if (/^\d{17}[\dX]$/.test(s)) {
      birth = s.slice(6, 10) + '-' + s.slice(10, 12) + '-' + s.slice(12, 14);
      var sum = 0;
      for (var i = 0; i < 17; i++) sum += Number(s.charAt(i)) * WEIGHT[i];
      valid = CHECK.charAt(sum % 11) === s.charAt(17);
      var d = new Date(birth);
      if (isNaN(d.getTime()) || d.getTime() > Date.now()) valid = false;
    } else if (/^\d{15}$/.test(s)) {
      birth = '19' + s.slice(6, 8) + '-' + s.slice(8, 10) + '-' + s.slice(10, 12);
      valid = !isNaN(new Date(birth).getTime());
    }

    var gender = '';
    if (valid || birth) {
      var seq = s.length === 18 ? s.charAt(16) : s.charAt(14);
      if (seq) gender = Number(seq) % 2 === 1 ? '男' : '女';
    }

    var age = null;
    if (birth && !isNaN(new Date(birth).getTime())) {
      var b = new Date(birth), now = new Date();
      age = now.getFullYear() - b.getFullYear();
      var m = now.getMonth() - b.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age -= 1;
    }

    return { birth: birth, age: age, gender: gender, valid: valid };
  }

  root.parseIdCard = parseIdCard;
  if (typeof module !== 'undefined' && module.exports) module.exports = { parseIdCard: parseIdCard };
})(typeof window !== 'undefined' ? window : globalThis);
