// i18n/patient.js - UI strings for the case view and the ward board. Keys start with 'pt.'.
// Amharic entries are DRAFT translations: an Ethiopian clinical and
// localization team must review them before facility use.
//
// Each key holds [English, Amharic draft] side by side for that review.
// {name} placeholders are filled by t(); an Amharic draft keeps exactly the
// placeholders of its English string (test/patient-view.test.mjs checks).
// Clinical abbreviations stay in Latin script as Ethiopian clinicians write
// them (FHR, BP, bpm, ROM, cm, mL, GA, G/P, the WHO form codes I C M+ B P).
// Not here on purpose: alert titles and advice, emergency names and protocol
// names come from the engine in English and stay English until the clinical
// panel validates translations.

const STRINGS = {
  // ------------------------------------------------ ward board (dashboard.js)
  'pt.board_empty': ['No women in labour are being monitored.', 'ክትትል እየተደረገላት ያለች ምጥ ላይ ያለች እናት የለችም።'],
  'pt.load_demo': ['Load a demo case (for training/evaluation)', 'የማሳያ ፋይል ጫን (ለስልጠና/ለግምገማ)'],
  'pt.board_in_labour': ['{n} in labour', '{n} በምጥ ላይ'],
  'pt.board_recent': ['Recent ({h} h)', 'የቅርብ ጊዜ ({h} ሰዓት)'],
  'pt.support_before': ['For support or implementation, reach out to', 'ለድጋፍ ወይም ለትግበራ ያግኙ፦'],
  'pt.support_name': ['Dr Temesgen Endalew', 'ዶ/ር ተመስገን እንዳለው'],
  'pt.support_after': ['(LinkedIn)', '(LinkedIn)'],
  'pt.card_active': ['active {d}', 'ንቁ ምጥ {d}'],
  'pt.card_second': ['2nd {d}', '2ኛ ምዕራፍ {d}'],
  'pt.card_next': ['next: {what} {d}', 'ቀጣይ: {what} በ{d} ውስጥ'],
  'pt.mrn': ['MRN {mrn}', 'ካርድ ቁ. {mrn}'],

  // ------------------------------------------- shared by board and case view
  'pt.unnamed': ['Unnamed', 'ስም አልተመዘገበም'],
  'pt.meta': ['{age} y · G{g}P{para} · GA {ga} wk', '{age} ዓመት · G{g}P{para} · GA {ga} ሳምንት'],
  'pt.since_birth': ['{d} since birth', 'ከወሊድ ወዲህ {d}'],
  'pt.dur_min': ['{m} min', '{m} ደቂቃ'],
  'pt.dur_h': ['{h} h', '{h} ሰዓት'],
  'pt.dur_h_min': ['{h} h {m} min', '{h} ሰዓት {m} ደቂቃ'],

  // ------------------------------------------------- case view: page and chart
  'pt.not_found': ['Case not found.', 'ፋይሉ አልተገኘም።'],
  'pt.tab_summary': ['Summary', 'ማጠቃለያ'],
  'pt.sheet': ['Sheet {n}: {from}-{to} h', 'ሉህ {n}: {from}-{to} ሰዓት'],
  'pt.sheets_label': ['LCG sheets', 'የLCG ሉሆች'],
  'pt.print_chart': ['Print chart', 'ቻርቱን አትም'],
  'pt.chart_note_lcg': [
    'Drawn from the entries like the WHO sheet: a value meeting the ALERT column is circled, solid red until its alert'
      + ' is acknowledged, then dashed grey. Each sheet covers {h} hours of the active first stage.'
      + ' Scroll sideways for the full timeline.',
    'እንደ WHO ቅጹ ከመዝገቦቹ የተሳለ ነው፦ የALERT አምዱን መስፈርት የሚያሟላ እሴት ይከበባል፤ ማስጠንቀቂያው ዕውቅና'
      + ' እስኪሰጠው ድረስ ሙሉ ቀይ ይሆናል፣ ከዚያ ግራጫ ነጠብጣብ ይሆናል። እያንዳንዱ ሉህ የንቁ የመጀመሪያ ምዕራፍን'
      + ' {h} ሰዓት ይሸፍናል። ሙሉውን የጊዜ ሰሌዳ ለማየት ወደ ጎን አንሸራት።',
  ],
  'pt.chart_note_partograph': [
    'Drawn from the entries: Ethiopian modified WHO partograph with its alert and action lines.'
      + ' Scroll sideways for the full timeline.',
    'ከመዝገቦቹ የተሳለ ነው፦ የኢትዮጵያ የተሻሻለ WHO ፓርቶግራፍ ከአለርት እና አክሽን መስመሮቹ ጋር።'
      + ' ሙሉውን የጊዜ ሰሌዳ ለማየት ወደ ጎን አንሸራት።',
  ],
  'pt.not_saved': ['Not saved: {err}', 'አልተቀመጠም: {err}'],

  // ------------------------------------------------------ case view: header
  'pt.chip_active': ['Active: {d}', 'ንቁ ምጥ: {d}'],
  'pt.chip_second': ['2nd stage: {d}', '2ኛ ምዕራፍ: {d}'],
  'pt.chip_pushing': ['Pushing since {time} ({d})', 'ማማጥ ከ{time} ጀምሮ ({d})'],
  'pt.chip_rom': ['ROM: {d}', 'ROM ከተከሰተ {d} ሆኗል'],
  'pt.chip_rom_unknown': ['ROM: time unknown', 'ROM: ጊዜው አይታወቅም'],
  'pt.chip_oxytocin': ['oxytocin running', 'ኦክሲቶሲን እየተሰጠ ነው'],
  'pt.record_check': ['Record check', 'ክትትል መዝግብ'],
  'pt.meds': ['Meds', 'መድኃኒት'],
  'pt.record': ['Record', 'መዝግብ'],
  'pt.pushing_msg_lcg': [
    'Record that pushing began now. This is the P on the LCG form: the WHO second-stage time limit counts from this time.',
    'ማማጥ አሁን መጀመሩን መዝግብ። ይህ በLCG ቅጹ ላይ ያለው P ነው፦ የWHO የሁለተኛ ምዕራፍ የጊዜ ገደብ ከዚህ ሰዓት ጀምሮ ይቆጠራል።',
  ],
  'pt.pushing_msg_partograph': [
    'Record that pushing began now. It is marked on the chart; this partograph times the second stage from full dilatation.',
    'ማማጥ አሁን መጀመሩን መዝግብ። በቻርቱ ላይ ምልክት ይደረግበታል፤ ይህ ፓርቶግራፍ የሁለተኛውን ምዕራፍ ጊዜ የሚቆጥረው ከሙሉ ክፍተት ጀምሮ ነው።',
  ],
  'pt.pushing_not_second': ['She is no longer in the second stage - nothing recorded', 'ከአሁን በኋላ በሁለተኛ ምዕራፍ ላይ አይደለችም - ምንም አልተመዘገበም'],
  'pt.pushing_already': ['Pushing is already recorded at {time}', 'ማማጥ ቀድሞ በ{time} ተመዝግቧል'],
  'pt.pushing_recorded': ['Pushing began {time} - recorded', 'ማማጥ በ{time} ጀመረ - ተመዝግቧል'],
  'pt.pick_help': ['Due items are pre-selected. Add or remove as needed.', 'ጊዜያቸው የደረሱት ቀድመው ተመርጠዋል። እንደ አስፈላጊነቱ ጨምር ወይም አስወግድ።'],

  // ------------------------------------------------- case view: alert strip
  'pt.unacked_one': ['{n} unacknowledged alert', 'ዕውቅና ያልተሰጠው {n} ማስጠንቀቂያ'],
  'pt.unacked_other': ['{n} unacknowledged alerts', 'ዕውቅና ያልተሰጣቸው {n} ማስጠንቀቂያዎች'],
  'pt.more_on_alerts_tab': ['{n} more on the Alerts tab.', 'ተጨማሪ {n} በማስጠንቀቂያዎች ገጽ ላይ አሉ።'],
  'pt.closed_ack_with_one': [
    '{n} closed alert not yet acknowledged will be acknowledged with them.',
    'ዕውቅና ያልተሰጠው {n} የተዘጋ ማስጠንቀቂያ ከእነዚህ ጋር ዕውቅና ይሰጠዋል።',
  ],
  'pt.closed_ack_with_other': [
    '{n} closed alerts not yet acknowledged will be acknowledged with them.',
    'ዕውቅና ያልተሰጣቸው {n} የተዘጉ ማስጠንቀቂያዎች ከእነዚህ ጋር ዕውቅና ይሰጣቸዋል።',
  ],
  'pt.closed_unacked_one': ['{n} closed alert not yet acknowledged', 'ዕውቅና ያልተሰጠው {n} የተዘጋ ማስጠንቀቂያ'],
  'pt.closed_unacked_other': ['{n} closed alerts not yet acknowledged', 'ዕውቅና ያልተሰጣቸው {n} የተዘጉ ማስጠንቀቂያዎች'],
  'pt.review_ack': ['Review & acknowledge', 'ተመልክተህ ዕውቅና ስጥ'],
  'pt.acknowledge': ['Acknowledge', 'ዕውቅና ስጥ'],

  // ------------------------------------- case view: entry values in words
  'pt.liquor_I': ['I (intact)', 'I (ያልተቀደደ)'],
  'pt.liquor_C': ['C (clear)', 'C (ንጹህ)'],
  'pt.liquor_M3': ['M+++ thick', 'M+++ ወፍራም'],
  'pt.liquor_B': ['B (blood)', 'B (ደም የቀላቀለ)'],
  'pt.liquor_M': ['M (grade not recorded)', 'M (ደረጃው አልተመዘገበም)'],
  'pt.seconds': ['{n} s', '{n} ሰከንድ'],
  'pt.urine_neg': ['neg', 'ኔጌቲቭ'],
  'pt.urine_trace': ['trace', 'ትሬስ'],
  'pt.ynd_Y': ['yes', 'አለ'],
  'pt.ynd_N': ['no', 'የለም'],
  'pt.ynd_D': ['declined', 'አልፈለገችም'],
  'pt.posture_upright': ['upright', 'ቀጥ ብላ'],
  'pt.posture_lateral': ['lateral', 'በጎኗ ተኝታ'],
  'pt.posture_supine': ['supine', 'በጀርባዋ ተኝታ'],
  'pt.posture_SP': ['supine (SP)', 'በጀርባዋ ተኝታ (SP)'],
  'pt.posture_MO': ['mobile (MO)', 'እየተንቀሳቀሰች (MO)'],
  'pt.position_unknown': ['position unsure', 'አቀማመጡ እርግጠኛ አይደለም'],
  'pt.pres_cephalic': ['cephalic', 'በራስ'],
  'pt.pres_breech': ['breech', 'በመቀመጫ'],
  'pt.pres_transverse': ['transverse', 'አግድም'],
  'pt.pres_other': ['other', 'ሌላ'],
  'pt.decel_early': ['early', 'ቀደምት'],
  'pt.decel_variable': ['variable', 'ተለዋዋጭ'],
  'pt.decel_late': ['late', 'የዘገየ'],
  'pt.decel_prolonged': ['prolonged', 'የተራዘመ'],
  'pt.bleeding_normal': ['normal', 'መደበኛ'],
  'pt.tone_firm': ['firm', 'ጠንካራ'],
  'pt.tone_soft': ['soft', 'ለስላሳ'],
  'pt.fundus_below': ['fundus below umbilicus', 'የማኅፀን ጫፍ ከእምብርት በታች'],
  'pt.fundus_at': ['fundus at umbilicus', 'የማኅፀን ጫፍ እምብርት ላይ'],
  'pt.fundus_above': ['fundus above umbilicus', 'የማኅፀን ጫፍ ከእምብርት በላይ'],
  'pt.breathing_normal': ['breathing normally', 'በመደበኛ ሁኔታ ይተነፍሳል'],
  'pt.breathing_difficult': ['breathing with difficulty', 'በችግር ይተነፍሳል'],
  'pt.breathing_none': ['NOT breathing', 'አይተነፍስም'],
  'pt.feeding_good': ['good', 'ጥሩ'],
  'pt.feeding_poor': ['poor', 'ደካማ'],
  'pt.loss_drape': ['calibrated drape', 'ልኬት ያለው ድሬፕ'],
  'pt.loss_weighed': ['weighed', 'በሚዛን የተለካ'],
  'pt.loss_estimate': ['estimated', 'በግምት'],
  'pt.med_medicine': ['Medicine', 'መድኃኒት'],
  'pt.med_ivfluid': ['IV fluids', 'IV ፈሳሽ'],
  'pt.med_oxytocin': ['Oxytocin', 'ኦክሲቶሲን'],

  // ------------------------------------- case view: one entry in one line
  'pt.s_fhr': ['FHR {v} bpm', 'FHR {v} bpm'],
  'pt.s_fhr_short': ['FHR {v}', 'FHR {v}'],
  'pt.s_decel': ['decel: {v}', 'ዲሴለሬሽን: {v}'],
  'pt.s_fluid': ['fluid {v}', 'የእንሽርት ውሃ {v}'],
  'pt.s_per10min': ['{n}/10 min', '{n}/10 ደቂቃ'],
  'pt.s_bpm': ['{v} bpm', '{v} bpm'],
  'pt.s_bp': ['BP {sys}/{dia}', 'BP {sys}/{dia}'],
  'pt.s_protein': ['protein {v}', 'ፕሮቲን {v}'],
  'pt.s_acetone': ['acetone {v}', 'አሴቶን {v}'],
  'pt.s_descent': ['descent {v}/5', 'የራስ መውረድ {v}/5'],
  'pt.s_caput': ['caput {v}', 'ካፑት {v}'],
  'pt.s_moulding': ['moulding {v}', 'ሞልዲንግ {v}'],
  'pt.s_companion': ['companion {v}', 'አጃቢ {v}'],
  'pt.s_pain_relief': ['pain relief {v}', 'የህመም ማስታገሻ {v}'],
  'pt.s_oral_fluid': ['oral fluid {v}', 'በአፍ የሚወሰድ ፈሳሽ {v}'],
  'pt.s_drops': ['{n} drops/min', '{n} ጠብታ/ደቂቃ'],
  'pt.s_bleeding_heavy': ['HEAVY bleeding', 'ከፍተኛ ደም መፍሰስ'],
  'pt.s_bleeding': ['bleeding {v}', 'ደም መፍሰስ {v}'],
  'pt.s_uterus': ['uterus {v}', 'ማኅፀን {v}'],
  'pt.s_pulse': ['pulse {v}', 'የልብ ምት {v}'],
  'pt.s_urine_passed': ['urine passed', 'ሸንታለች'],
  'pt.s_urine_not_passed': ['no urine passed yet', 'እስካሁን አልሸናችም'],
  'pt.s_feeding': ['feeding {v}', 'ጡት መጥባት {v}'],
  'pt.s_loss_total': ['{n} mL in total so far', 'እስካሁን በአጠቃላይ {n} mL'],

  // ---------------------------------------------------- case view: entries
  'pt.n_voided': ['{n} voided', '{n} ውድቅ የተደረጉ'],
  'pt.col_time': ['Time', 'ሰዓት'],
  'pt.col_type': ['Type', 'ዓይነት'],
  'pt.col_values': ['Values', 'ውጤቶች'],
  'pt.no_entries': ['No entries yet.', 'እስካሁን ምንም መዝገብ የለም።'],
  'pt.meds_title': ['Medication / fluids', 'መድኃኒት / ፈሳሾች'],
  'pt.at_admission': ['admission', 'በምዝገባ ጊዜ'],
  'pt.by': ['by {by}', 'በ{by}'],
  'pt.corrected_entry': ['Corrected entry', 'የተስተካከለ መዝገብ'],
  'pt.voided_by': ['Voided by {by}: {reason}', 'በ{by} ውድቅ ተደርጓል: {reason}'],
  'pt.correct': ['Correct', 'አስተካክል'],
  'pt.void': ['Void', 'ውድቅ አድርግ'],

  // ------------------------- case view: void and correct (what will change)
  'pt.void_both_revert': [
    'The second stage and active labour revert to the latent phase. Their timers restart from the next exams'
      + ' at {cm} cm or more and at full dilatation (10 cm).',
    'ሁለተኛው ምዕራፍ እና ንቁ ምጥ ወደ ድብቅ ምዕራፍ ይመለሳሉ። የጊዜ ቆጣሪዎቻቸው እንደገና የሚጀምሩት ከሚቀጥሉት'
      + ' ምርመራዎች ነው፦ {cm} cm ወይም ከዚያ በላይ ሲሆን እና ሙሉ ክፍተት (10 cm) ሲደርስ።',
  ],
  'pt.void_second_reverts': [
    'The second stage reverts to the active first stage. Its timer restarts from the next exam at full dilatation (10 cm).',
    'ሁለተኛው ምዕራፍ ወደ ንቁ የመጀመሪያ ምዕራፍ ይመለሳል። የጊዜ ቆጣሪው እንደገና የሚጀምረው ሙሉ ክፍተት (10 cm) ከሚያሳየው ቀጣይ ምርመራ ነው።',
  ],
  'pt.void_active_reverts': [
    'Active labour reverts to the latent phase. The active-stage timer restarts from the next exam at {cm} cm or more.',
    'ንቁ ምጥ ወደ ድብቅ ምዕራፍ ይመለሳል። የንቁ ምዕራፍ የጊዜ ቆጣሪ እንደገና የሚጀምረው {cm} cm ወይም ከዚያ በላይ ከሚያሳየው ቀጣይ ምርመራ ነው።',
  ],
  'pt.void_active_moved': ['The active first stage will start at {after} instead of {before}.', 'ንቁው የመጀመሪያ ምዕራፍ ከ{before} ይልቅ በ{after} ይጀምራል።'],
  'pt.void_second_moved': ['The second stage will start at {after} instead of {before}.', 'ሁለተኛው ምዕራፍ ከ{before} ይልቅ በ{after} ይጀምራል።'],
  'pt.void_active_starts': ['Active labour will start at {at}.', 'ንቁ ምጥ በ{at} ይጀምራል።'],
  'pt.void_second_starts': ['The second stage will start at {at}.', 'ሁለተኛው ምዕራፍ በ{at} ይጀምራል።'],
  'pt.push_clock_moved': [
    'The second-stage limit will count from pushing at {after} instead of {before}.',
    'የሁለተኛ ምዕራፍ የጊዜ ገደብ ከ{before} ይልቅ በ{after} ከጀመረው ማማጥ ይቆጠራል።',
  ],
  'pt.push_clock_from_push': [
    'The second-stage limit will count from pushing at {after} instead of from full dilatation.',
    'የሁለተኛ ምዕራፍ የጊዜ ገደብ ከሙሉ ክፍተት ይልቅ በ{after} ከጀመረው ማማጥ ይቆጠራል።',
  ],
  'pt.push_clock_from_full': [
    'The second-stage limit will count from full dilatation ({time}) until pushing is recorded again.',
    'ማማጥ እንደገና እስኪመዘገብ ድረስ የሁለተኛ ምዕራፍ የጊዜ ገደብ ከሙሉ ክፍተት ({time}) ጀምሮ ይቆጠራል።',
  ],
  'pt.void_alert_closes': ['Alert will close: {title}', 'ማስጠንቀቂያው ይዘጋል: {title}'],
  'pt.void_alert_reopens': ['Alert will re-open: {title}', 'ማስጠንቀቂያው እንደገና ይከፈታል: {title}'],
  'pt.void_alert_opens': ['Alert will open: {title}', 'ማስጠንቀቂያ ይከፈታል: {title}'],
  'pt.void_no_change': ['No change to the labour stage or to any alert.', 'በምጥ ምዕራፉም ሆነ በማንኛውም ማስጠንቀቂያ ላይ ለውጥ የለም።'],
  'pt.void_title': ['Void entry: {type} at {time}', 'መዝገብ ውድቅ ማድረግ: {type} ({time})'],
  'pt.void_message': [
    '{summary}. The entry stays on the record, struck through, with your initials and the reason. What changes:',
    '{summary}። መዝገቡ በመስመር ተሰርዞ ከስምህ መጀመሪያ ፊደላት እና ከምክንያቱ ጋር በፋይሉ ውስጥ ይቆያል። የሚለወጠው፦',
  ],
  'pt.void_ok': ['Void entry', 'መዝገቡን ውድቅ አድርግ'],
  'pt.voided_toast': ['Entry voided - kept on the record, struck through', 'መዝገቡ ውድቅ ተደርጓል - በመስመር ተሰርዞ በፋይሉ ውስጥ ይቆያል'],
  'pt.reopened_one': ['{n} alert re-opened - see Alerts', '{n} ማስጠንቀቂያ እንደገና ተከፍቷል - ማስጠንቀቂያዎችን ተመልከት'],
  'pt.reopened_other': ['{n} alerts re-opened - see Alerts', '{n} ማስጠንቀቂያዎች እንደገና ተከፍተዋል - ማስጠንቀቂያዎችን ተመልከት'],
  'pt.opened_one': ['{n} new alert opened - see Alerts', '{n} አዲስ ማስጠንቀቂያ ተከፍቷል - ማስጠንቀቂያዎችን ተመልከት'],
  'pt.opened_other': ['{n} new alerts opened - see Alerts', '{n} አዲስ ማስጠንቀቂያዎች ተከፍተዋል - ማስጠንቀቂያዎችን ተመልከት'],
  'pt.correct_title': ['Correct entry: {type} at {time}', 'መዝገብ ማስተካከል: {type} ({time})'],
  'pt.correct_message': [
    '{summary}. This entry is voided (kept on the record, struck through) and your corrected values'
      + ' are recorded for the same time. Taking the old values out:',
    '{summary}። ይህ መዝገብ ውድቅ ይደረጋል (በመስመር ተሰርዞ በፋይሉ ውስጥ ይቆያል)፤ ያስተካከልካቸው ውጤቶች ለዚያው'
      + ' ሰዓት ይመዘገባሉ። የቀድሞዎቹን ውጤቶች ማስወጣት የሚያመጣው ለውጥ፦',
  ],
  'pt.correct_recheck': [
    'The corrected values are then checked again, so a stage or an alert can return.',
    'ከዚያ የተስተካከሉት ውጤቶች እንደገና ይፈተሻሉ፤ ስለዚህ ምዕራፍ ወይም ማስጠንቀቂያ ተመልሶ ሊመጣ ይችላል።',
  ],
  'pt.correct_ok': ['Enter corrected values', 'የተስተካከሉ ውጤቶችን አስገባ'],

  // ----------------------------------------------------- case view: alerts
  'pt.how_evidence': ['a later reading was normal', 'ቀጣዩ ልኬት መደበኛ ነበር'],
  'pt.how_cleared': ['the time condition cleared', 'የጊዜ ሁኔታው ተስተካክሏል'],
  'pt.how_void': ['the entry behind it was voided', 'ያስነሳው መዝገብ ውድቅ ተደርጓል'],
  'pt.how_birth': ['closed at birth', 'በወሊድ ጊዜ ተዘግቷል'],
  'pt.how_manual': ['resolved by hand', 'በእጅ ተዘግቷል'],
  'pt.how_handover': ['closed at departure', 'ስትሄድ ተዘግቷል'],
  'pt.how_restaged': [
    'no longer an alert value at that stage of labour',
    'በዚያ የምጥ ምዕራፍ የማስጠንቀቂያ ውጤት አይደለም',
  ],
  'pt.how_closed': ['closed', 'ተዘግቷል'],
  'pt.action_monitoring': ['continue close monitoring', 'የቅርብ ክትትል መቀጠል'],
  'pt.action_senior': ['senior or colleague called', 'ከፍተኛ ባለሙያ ወይም ባልደረባ ተጠርቷል'],
  'pt.action_intervention': ['intervention given', 'ሕክምና ተሰጥቷል'],
  'pt.action_referral': ['referral started', 'ሪፈራል ተጀምሯል'],
  'pt.no_alerts': ['No alerts so far.', 'እስካሁን ምንም ማስጠንቀቂያ የለም።'],
  'pt.alert_episode': ['episode {n}', 'ዙር {n}'],
  'pt.alert_seen': ['seen {n} times', '{n} ጊዜ ታይቷል'],
  'pt.alert_raised_by': ['raised by {by}', 'በ{by} የተነሳ'],
  'pt.alert_closed': ['Closed {time}: {how}', 'ተዘግቷል {time}: {how}'],
  'pt.alert_closed_by': ['Closed {time}: {how} by {by}', 'ተዘግቷል {time}: {how} (በ{by})'],
  'pt.alert_open': ['Open', 'ክፍት'],
  'pt.alert_escalated': ['severity raised {time}', 'ክብደቱ ጨምሯል {time}'],
  'pt.alert_acked': ['Acknowledged {time}', 'ዕውቅና ተሰጥቷል {time}'],
  'pt.alert_acked_by': ['Acknowledged {time} by {by}', 'ዕውቅና ተሰጥቷል {time} (በ{by})'],
  'pt.alert_not_acked': ['Not yet acknowledged', 'ገና ዕውቅና አልተሰጠውም'],
  'pt.already_acked': ['Already acknowledged', 'ቀድሞ ዕውቅና ተሰጥቶታል'],
  'pt.resolve': ['Resolve', 'ዝጋ'],
  'pt.resolve_title': ['Resolve alert', 'ማስጠንቀቂያውን ዝጋ'],
  'pt.resolve_message': [
    '{title}. Resolve by hand only when the finding no longer applies; a new finding later opens a new alert.',
    '{title}። ግኝቱ ከአሁን በኋላ የማይመለከት ሲሆን ብቻ በእጅ ዝጋ፤ በኋላ የሚገኝ አዲስ ግኝት አዲስ ማስጠንቀቂያ ይከፍታል።',
  ],
  'pt.resolve_message_time': [
    'A time alert opens again at the next check while its condition still holds.',
    'የጊዜ ማስጠንቀቂያ ሁኔታው እስካለ ድረስ በሚቀጥለው ፍተሻ እንደገና ይከፈታል።',
  ],
  'pt.alert_already_closed': ['this alert is already closed', 'ይህ ማስጠንቀቂያ ቀድሞ ተዘግቷል'],
  'pt.resolved_toast': ['Alert resolved', 'ማስጠንቀቂያው ተዘግቷል'],
  'pt.resolved_toast_unacked': ['Alert resolved - it still needs acknowledging', 'ማስጠንቀቂያው ተዘግቷል - አሁንም ዕውቅና መስጠት ያስፈልገዋል'],

  // -------------------------------------------------- case view: emergency
  'pt.emergency_help': ['Tap the emergency — immediate actions will be shown and recorded.', 'ድንገተኛ ሁኔታውን ንካ — አስቸኳይ እርምጃዎቹ ይታያሉ፣ ይመዘገባሉም።'],
  'pt.initials_required': ['Your initials are required.', 'የስምህ መጀመሪያ ፊደላት ያስፈልጋሉ።'],
  'pt.emergency_recorded': ['Emergency recorded', 'ድንገተኛ አደጋው ተመዝግቧል'],
  'pt.emergency_record': ['Record & open referral', 'መዝግብና ሪፈራል ክፈት'],

  // ---------------------------------------------------- case view: summary
  'pt.notes_title': ['Notes — shared decision-making', 'ማስታወሻዎች — የጋራ ውሳኔ'],
  'pt.plan': ['Plan: {plan}', 'ዕቅድ: {plan}'],
  'pt.add_note': ['Add note', 'ማስታወሻ ጨምር'],
  'pt.note_placeholder': ['Assessment / findings…', 'ግምገማ / ግኝቶች…'],
  'pt.plan_placeholder': ['Plan (shared with the woman)…', 'ዕቅድ (ከእናቲቱ ጋር የተጋራ)…'],
  'pt.note_empty': ['Write the assessment or the plan.', 'ግምገማውን ወይም ዕቅዱን ጻፍ።'],
  'pt.note_saved': ['Note saved', 'ማስታወሻው ተቀምጧል'],
  'pt.admission_title': ['Admission', 'ምዝገባ'],
  'pt.adm_admitted': ['Admitted', 'የተመዘገበችበት'],
  'pt.adm_onset': ['Labour onset', 'የምጥ አጀማመር'],
  'pt.adm_rom': ['Membranes / ROM', 'የእንሽርት ሽፋን / ROM'],
  'pt.adm_exam': ['Admission exam', 'የምዝገባ ምርመራ'],
  'pt.adm_active_from': ['Active first stage from', 'ንቁ የመጀመሪያ ምዕራፍ የጀመረው'],
  'pt.adm_second_from': ['Second stage from', 'ሁለተኛ ምዕራፍ የጀመረው'],
  'pt.adm_companion': ['Companion of choice wanted', 'የመረጠችው አጃቢ እንዲኖር ትፈልጋለች'],
  'pt.adm_risk': ['Risk factors', 'የተጋላጭነት ምክንያቶች'],
  'pt.adm_contact': ['Contact', 'አድራሻ'],
  'pt.adm_protocol': ['Protocol', 'ፕሮቶኮል'],
  'pt.onset_spontaneous': ['Spontaneous', 'በራሱ የጀመረ'],
  'pt.onset_induced': ['Induced', 'የተቀሰቀሰ'],
  'pt.onset_began': ['began {time}', '{time} ላይ ጀመረ'],
  'pt.rom_ruptured_unknown': ['Ruptured - ROM time unknown', 'ሽፋኑ ተቀዷል - የROM ሰዓት አይታወቅም'],
  'pt.rom_ruptured_at': ['Ruptured {time}', 'ሽፋኑ {time} ላይ ተቀዷል'],
  'pt.rom_intact': ['Intact (no rupture recorded)', 'ያልተቀደደ (መቀደድ አልተመዘገበም)'],
  'pt.not_recorded': ['Not recorded', 'አልተመዘገበም'],
  'pt.not_reached': ['Not reached', 'ገና አልደረሰም'],
  'pt.none_recorded': ['None recorded', 'ምንም አልተመዘገበም'],

  // ------------------------------------- case view: completeness (audit) card
  'pt.audit_title_lcg': ['LCG completeness', 'የLCG ሙሉነት'],
  'pt.audit_title_partograph': ['Partograph completeness', 'የፓርቶግራፍ ሙሉነት'],
  'pt.audit_not_applicable': ['Not applicable - the active first stage has not started.', 'አይመለከትም - ንቁው የመጀመሪያ ምዕራፍ ገና አልጀመረም።'],
  'pt.audit_score': ['Score', 'ውጤት'],
  'pt.audit_not_scored': ['not scored yet', 'ገና አልተገመገመም'],
  'pt.audit_header': ['Header: name, parity, labour onset', 'ርዕስ: ስም፣ የወሊድ ብዛት፣ የምጥ አጀማመር'],
  'pt.audit_woman': ['Woman', 'እናቲቱ'],
  'pt.audit_progress': ['Labour progress', 'የምጥ ሂደት'],
  'pt.audit_medication': ['Medication (oxytocin)', 'መድኃኒት (ኦክሲቶሲን)'],
  'pt.audit_na': ['not applicable', 'አይመለከትም'],
  'pt.audit_decisions': ['Assessment and plan, hourly', 'ግምገማ እና ዕቅድ፣ በየሰዓቱ'],
  'pt.audit_initials': ['Initials, hourly', 'የስም መጀመሪያ ፊደላት፣ በየሰዓቱ'],
  'pt.audit_alerts_acked': ['Alerts acknowledged within {n} min', 'በ{n} ደቂቃ ውስጥ ዕውቅና የተሰጣቸው ማስጠንቀቂያዎች'],
  'pt.audit_no_alerts': ['no alerts', 'ማስጠንቀቂያ የለም'],
  'pt.audit_nothing_due': ['nothing due yet', 'ገና ጊዜው የደረሰ የለም'],
  'pt.audit_defaulted': ['Values kept at the default', 'ሳይለወጡ በነባሪ እሴት የቀሩ'],
  'pt.audit_defaulted_one': ['{v} in {n} entry', 'በ{n} መዝገብ ውስጥ {v}'],
  'pt.audit_defaulted_other': ['{v} in {n} entries', 'በ{n} መዝገቦች ውስጥ {v}'],
  'pt.audit_voided': ['Voided entries', 'ውድቅ የተደረጉ መዝገቦች'],
  'pt.audit_active': ['Active first stage', 'ንቁ የመጀመሪያ ምዕራፍ'],
  'pt.audit_second': ['Second stage', 'ሁለተኛ ምዕራፍ'],
  'pt.audit_completed': ['Meets the "LCG completed" indicator definition.', 'የ"LCG ተሟልቷል" አመላካች ትርጓሜን ያሟላል።'],
  'pt.audit_not_completed': ['Does not meet the "LCG completed" indicator definition yet.', 'የ"LCG ተሟልቷል" አመላካች ትርጓሜን ገና አያሟላም።'],

  // ----------------------------------------- case view: closing and actions
  'pt.close_err_closed': ['The case is already closed', 'ፋይሉ ቀድሞ ተዘግቷል'],
  'pt.close_err_labour': [
    'A case in labour cannot be closed - record the birth or the handover first',
    'በምጥ ላይ ያለች እናት ፋይል ሊዘጋ አይችልም - መጀመሪያ ወሊዱን ወይም ርክክቡን መዝግብ',
  ],
  'pt.close_err_initials': ['Initials are required to close a case', 'ፋይል ለመዝጋት የስም መጀመሪያ ፊደላት ያስፈልጋሉ'],
  'pt.close_case': ['Close case', 'ፋይሉን ዝጋ'],
  'pt.close_message': [
    'Close this case? It moves out of the active list but stays in records/reports.',
    'ይህ ፋይል ይዘጋ? ከንቁ ዝርዝሩ ይወጣል፣ ግን በመዝገቦች/ሪፖርቶች ውስጥ ይቆያል።',
  ],
  'pt.close_message_watch': [
    'She is still in the postpartum watch: closing stops its checks and reminders.',
    'አሁንም በድኅረ ወሊድ ክትትል ላይ ናት፦ መዝጋት ፍተሻዎቹንና አስታዋሾቹን ያቆማል።',
  ],
  'pt.case_actions': ['Case actions', 'የፋይል ተግባራት'],
  'pt.export_fhir': ['Export FHIR R4 (JSON)', 'FHIR R4 (JSON) አውርድ'],
  'pt.print_summary': ['Print summary', 'ማጠቃለያውን አትም'],
  'pt.delete_case': ['Delete case', 'ፋይሉን አጥፋ'],
  'pt.delete_confirm': ['Delete this DEMO case permanently? This cannot be undone.', 'ይህ የማሳያ (DEMO) ፋይል እስከመጨረሻው ይጥፋ? ይህ ሊቀለበስ አይችልም።'],
  'pt.delete': ['Delete', 'አጥፋ'],
  'pt.not_deleted': ['Not deleted: {err}', 'አልጠፋም: {err}'],
  'pt.real_cases_note': [
    'Real cases are closed, never deleted: the record is kept for audit and reports.',
    'እውነተኛ ፋይሎች ይዘጋሉ እንጂ አይጠፉም፦ መዝገቡ ለኦዲት እና ለሪፖርቶች ይቀመጣል።',
  ],
};

export const en = Object.fromEntries(Object.entries(STRINGS).map(([key, [english]]) => [key, english]));
export const am = Object.fromEntries(Object.entries(STRINGS).map(([key, [, amharic]]) => [key, amharic]));
