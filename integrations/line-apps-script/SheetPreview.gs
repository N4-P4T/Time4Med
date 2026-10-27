/**
 * Time4Med / Google Apps Script: READ-ONLY schedule and recipient inspection.
 *
 * Requires Script Property TIME4MED_SHEET_ID to point to the intended spreadsheet.
 * Run previewTime4MedData() manually.
 *
 * Does NOT modify Sheets, send LINE, create triggers, open webhook, or call Cloudflare.
 * Data source is MealMedicines (website/current workflow), NOT legacy Schedules;
 * do not combine both because they can be two representations of the same dose.
 *
 * This preview intentionally excludes demo/test medicine names, invalid rows,
 * and records not explicitly marked active. All log output omits personal names,
 * medicine names, emails and LINE user IDs.
 */
var T4M_PREVIEW_MAX_ROWS = 1000;
var T4M_PREVIEW_VALID_PATIENTS = {P001:1, P002:2, P003:3};

function t4mPreviewReadTable_(spreadsheet, name, headerRow, required) {
  var sheet = spreadsheet.getSheetByName(name);
  if (!sheet) throw new Error('TIME4MED_TAB_NOT_FOUND_' + name);
  var cols = sheet.getLastColumn();
  var lastRow = sheet.getLastRow();
  if (!Number.isSafeInteger(cols) || cols <= 0 || cols > 60 ||
      !Number.isSafeInteger(lastRow) || lastRow < headerRow ||
      lastRow - headerRow > T4M_PREVIEW_MAX_ROWS)
    throw new Error('TIME4MED_SHEET_BOUNDS_INVALID_' + name);

  var header = sheet.getRange(headerRow,1,1,cols).getDisplayValues()[0].map(
    function(x){return String(x||'').trim();}
  );
  var colMap = {};
  header.forEach(function(h,i){
    if (h && !Object.prototype.hasOwnProperty.call(colMap,h))
      colMap[h]=i;
  });
  required.forEach(function(key){
    if (!Object.prototype.hasOwnProperty.call(colMap,key))
      throw new Error('TIME4MED_HEADER_MISSING_' + name + '_' + key);
  });
  var rows = lastRow>headerRow
    ? sheet.getRange(headerRow+1,1,lastRow-headerRow,cols).getDisplayValues()
    : [];
  return {rows:rows,col:colMap};
}
function t4mPreviewGet_(data,row,colName) {
  return String(row[data.col[colName]]||'').trim();
}
function t4mPreviewIsTrue_(s) {
  return String(s).trim().toUpperCase()==='TRUE';
}
function t4mPreviewValidTime_(s) {
  return /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(s);
}
function t4mPreviewIsDemo_(name) {
  return /(?:^|[\s_-])TEST(?:[\s_-]|$)|ทดสอบ|ตัวอย่าง|DEMO|SAMPLE/i.test(name);
}

/**
 * Returns de-identified preview. Never sends notifications.
 * A row counts as ready only if enabled, non-demo, within patient shelves 1-3,
 * meal 1-7 and has a valid HH:MM reminder time.
 */
function t4mPreviewInspectMedicines_(data) {
  var result={
    scanned:0,active:0,demoExcluded:0,invalidExcluded:0,eligible:0,
    candidateReminders:[],issues:[]
  };
  var dup={};
  data.rows.forEach(function(row){
    if (!row.length || !String(row[0]||'').trim()) return;
    result.scanned++;
    if (!t4mPreviewIsTrue_(t4mPreviewGet_(data,row,'is_active'))) return;
    result.active++;

    var name=t4mPreviewGet_(data,row,'name');
    if (t4mPreviewIsDemo_(name)) {
      result.demoExcluded++;
      return;
    }
    var patient=t4mPreviewGet_(data,row,'patient_id');
    var box=t4mPreviewGet_(data,row,'box_number');
    var kind=t4mPreviewGet_(data,row,'kind').toLowerCase();
    var time=t4mPreviewGet_(data,row,'reminder_time');
    var meal=t4mPreviewGet_(data,row,'meal_type');
    var boxNum=/^\d{1,2}$/.test(box)?Number(box):NaN;

    if (!Object.prototype.hasOwnProperty.call(T4M_PREVIEW_VALID_PATIENTS,patient) ||
        boxNum!==T4M_PREVIEW_VALID_PATIENTS[patient] ||
        kind!=='scheduled' ||
        !t4mPreviewValidTime_(time) ||
        !/^[1-7]$/.test(meal)) {
      result.invalidExcluded++;
      result.issues.push({rowInvalid:true,patientCode:/^P00[1-3]$/.test(patient)?patient:'UNKNOWN'});
      return;
    }

    // Do not deduplicate here: multiple different medicines may be due at
    // the same time. Count times for future grouping, not per-pill LINE sends.
    var groupKey=patient+'|'+time+'|'+meal;
    dup[groupKey]=(dup[groupKey]||0)+1;
    result.eligible++;
    result.candidateReminders.push({
      patientId:patient,
      shelf:T4M_PREVIEW_VALID_PATIENTS[patient],
      mealCode:meal,
      time:time
    });
  });
  result.candidateReminders.sort(function(a,b){
    return a.time.localeCompare(b.time) ||
      a.patientId.localeCompare(b.patientId) ||
      a.mealCode.localeCompare(b.mealCode);
  });
  result.sameSlotMedicineGroups=Object.keys(dup).filter(function(key){return dup[key]>1;}).length;
  return result;
}
function t4mPreviewInspectRecipients_(data) {
  var out={scanned:0,eligibleAccounts:0,
    disabledOrInactive:0,invalidOrMissingLineId:0,eligibleByRole:{}};
  data.rows.forEach(function(row){
    if(!String(row[0]||'').trim()) return;
    out.scanned++;
    var role=t4mPreviewGet_(data,row,'role').toUpperCase();
    var enabled=t4mPreviewIsTrue_(t4mPreviewGet_(data,row,'notification_enabled'));
    var active=t4mPreviewGet_(data,row,'status').toUpperCase()==='ACTIVE';
    if (!enabled || !active || (role!=='CAREGIVER' && role!=='ADMIN')) {
      out.disabledOrInactive++;
      return;
    }
    if (!/^U[0-9a-fA-F]{32}$/.test(t4mPreviewGet_(data,row,'line_user_id'))) {
      out.invalidOrMissingLineId++;
      return;
    }
    out.eligibleAccounts++;
    out.eligibleByRole[role]=(out.eligibleByRole[role]||0)+1;
  });
  return out;
}

/** Execute manually in Google Apps Script. Reads only; no LINE calls. */
function previewTime4MedData() {
  var props=PropertiesService.getScriptProperties();
  var id=props.getProperty('TIME4MED_SHEET_ID');
  if (!id || !/^[a-zA-Z0-9_-]{25,}$/.test(id))
    throw new Error('TIME4MED_SHEET_ID_MISSING_OR_INVALID');
  var ss=SpreadsheetApp.openById(id);
  var medicines=t4mPreviewReadTable_(
    ss,'MealMedicines',1,
    ['record_id','patient_id','name','kind','meal_type','box_number','reminder_time','is_active']
  );
  var users=t4mPreviewReadTable_(
    ss,'Users',4,
    ['user_id','role','patient_id','line_user_id','notification_enabled','status']
  );
  var result={
    source:'MealMedicines',
    mode:'READ_ONLY_NO_NOTIFICATIONS',
    medicines:t4mPreviewInspectMedicines_(medicines),
    recipients:t4mPreviewInspectRecipients_(users)
  };
  // Only patient codes, counts and times; never print secrets or health data.
  console.log(JSON.stringify(result));
  return result;
}
