// Deliberately "legacy enterprise" markup: table-based layout, no semantic tags,
// no test IDs, inline styling, generic non-descriptive class names. This is the
// hostile surface the agent and replay engine both have to cope with.

export function page(title: string, body: string): string {
  return `<html><head><title>${title}</title></head>
<body style="font-family: Tahoma, sans-serif; font-size: 12px;">
<table width="100%" cellpadding="4" cellspacing="0" border="0" bgcolor="#003366">
  <tr><td><font color="white"><b>Meridian Credit Union &mdash; Teller Console</b></font></td></tr>
</table>
<table width="100%" cellpadding="10"><tr><td>
${body}
</td></tr></table>
</body></html>`;
}

export function loginPage(error?: string): string {
  return page(
    "Login",
    `
<table cellpadding="4">
<form method="post" action="/login">
<tr><td>Username</td><td><input type="text" name="username"></td></tr>
<tr><td>Password</td><td><input type="password" name="password"></td></tr>
<tr><td colspan="2">${error ? `<font color="red">${error}</font>` : ""}</td></tr>
<tr><td colspan="2"><input type="submit" value="Sign In"></td></tr>
</form>
</table>`
  );
}

export function searchPage(notice?: string): string {
  return page(
    "Member Search",
    `
<table cellpadding="4">
<form method="post" action="/members/search">
<tr><td>Member ID</td><td><input type="text" name="memberId"></td></tr>
<tr><td colspan="2">${notice ? `<font color="red">${notice}</font>` : ""}</td></tr>
<tr><td colspan="2"><input type="submit" value="Look Up Member"></td></tr>
</form>
</table>`
  );
}

export function memberDetailPage(member: {
  id: string;
  name: string;
  status: string;
  savingsBalance: number;
  ssn: string;
}): string {
  return page(
    "Member Detail",
    `
<table><tbody><tr><td>
  <table border="1" cellpadding="6">
    <tbody>
    <tr><td><table><tr><td><b>Member ID</b></td><td>${member.id}</td></tr></table></td></tr>
    <tr><td><table><tr><td><b>Name</b></td><td>${member.name}</td></tr></table></td></tr>
    <tr><td><table><tr><td><b>Status</b></td><td>${member.status}</td></tr></table></td></tr>
    <tr><td><table><tr><td><b>SSN</b></td><td>${member.ssn}</td></tr></table></td></tr>
    <tr><td><table><tr><td><b>Savings Balance</b></td><td>$${member.savingsBalance.toFixed(
      2
    )}</td></tr></table></td></tr>
    </tbody>
  </table>
</td></tr>
<tr><td><br>
  <iframe src="/members/${member.id}/sub-accounts/new" width="480" height="220" frameborder="1"></iframe>
</td></tr>
</tbody></table>`
  );
}

export function frozenMemberPage(memberId: string): string {
  return page(
    "Member Detail",
    `<font color="red"><b>Action Denied:</b> Member ${memberId} is FROZEN. Sub-account creation and balance actions are not permitted for frozen members.</font>
<br><br><a href="/members/search">Back to Search</a>`
  );
}

export function notFoundPage(memberId: string): string {
  return page(
    "Member Search",
    `<font color="red">No member found with ID ${memberId}.</font>
<br><br>${searchPage()}`
  );
}

export function sessionExpiredInterstitial(memberId: string): string {
  return page(
    "Session Expired",
    `
<table bgcolor="#fff3cd" cellpadding="8"><tr><td>
<b>Your session has expired.</b> Please re-authenticate to continue this action.
</td></tr></table>
<br>
<form method="post" action="/reauthenticate">
<input type="hidden" name="returnTo" value="/members/${memberId}/sub-accounts/new">
<input type="submit" value="Re-authenticate">
</form>`
  );
}

export function subAccountFormFrame(memberId: string, error?: string): string {
  return `<html><body style="font-family: Tahoma, sans-serif; font-size: 12px;">
<table cellpadding="4">
<form method="post" action="/members/${memberId}/sub-accounts">
<tr><td>Account Type</td><td>
  <select name="type">
    <option value="share">Share Savings</option>
    <option value="christmas_club">Christmas Club</option>
    <option value="money_market">Money Market</option>
  </select>
</td></tr>
<tr><td>Nickname</td><td><input type="text" name="nickname"></td></tr>
<tr><td>Initial Deposit</td><td><input type="text" name="deposit"></td></tr>
<tr><td colspan="2">${error ? `<font color="red">${error}</font>` : ""}</td></tr>
<tr><td colspan="2"><input type="submit" value="Open Sub-Account"></td></tr>
</form>
</table>
</body></html>`;
}

export function confirmationPage(memberId: string, subAccountId: string, type: string, nickname: string, deposit: number): string {
  return page(
    "Confirmation",
    `
<table bgcolor="#d4edda" cellpadding="8"><tr><td>
<b>Sub-account opened successfully.</b>
</td></tr></table>
<br>
<table border="1" cellpadding="6">
<tr><td><b>Confirmation Number</b></td><td>${subAccountId}</td></tr>
<tr><td><b>Member ID</b></td><td>${memberId}</td></tr>
<tr><td><b>Account Type</b></td><td>${type}</td></tr>
<tr><td><b>Nickname</b></td><td>${nickname}</td></tr>
<tr><td><b>Initial Deposit</b></td><td>$${deposit.toFixed(2)}</td></tr>
</table>`
  );
}
