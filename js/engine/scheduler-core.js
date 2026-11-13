/* 純邏輯自動排課求解器與品質稽核引擎（零 DOM 相依，可於 Web Worker 與 Node 獨立執行） */

  function buildAutoScheduleQualityReport ({ schedule, optP8Only, autoEndPeriod, onePerDay = true, ignoreTeacherConsecutiveIds = [], ignoreScheduleIds = [], allowSoftTeacherExclusives = false }) {
    const ignoredTeacherConsecutiveIds = new Set((ignoreTeacherConsecutiveIds || []).map(id => String(id || '').trim()).filter(Boolean));
    const ignoredScheduleIds = new Set((ignoreScheduleIds || []).map(id => String(id || '').trim()).filter(Boolean));
      const isHelper = code => /輔$/i.test(String(code || '').trim());
     const alternateClassSubjectKeys = new Set((state.assignments || [])
       .filter(assignment => isAlternateWeeklyValue(getAssignmentWeeklyValue(assignment, idx.subjectByCode?.[String(assignment['科目代碼'] || '').trim()], 3)))
       .map(assignment => String(assignment['班級代碼'] || '').trim() + '|' + String(assignment['科目代碼'] || '').trim()));
     const isAlternateAssignment = (classCode, subjectCode) => alternateClassSubjectKeys.has(
       String(classCode || '').trim() + '|' + String(subjectCode || '').trim()
     );
     const isAlternateEntry = entry => {
       const period = parseInt(entry?.['節次'], 10);
       const attr = String(entry?.['課堂屬性'] || '').trim();
       return period === 8 && (attr === '單週' || attr === '雙週');
     };
     const inScope = (code, classCode = '', entry = null) => {
       const alternate = isAlternateEntry(entry) || isAlternateAssignment(classCode, code);
       return optP8Only
         ? isHelper(code) || alternate
         : (autoEndPeriod <= 7 ? !isHelper(code) && !alternate : true);
     };
    const reportPeriod = entry => parseInt(entry?.['節次'], 10);
    const reportWeekType = entry => {
      const period = reportPeriod(entry);
      const attr = String(entry?.['課堂屬性'] || '').trim();
      return period === 8 && (attr === '單週' || attr === '雙週') ? attr : '全週';
    };
    const reportInScope = entry => {
      const period = reportPeriod(entry);
       return Number.isFinite(period) && period >= 1 && period <= Number(autoEndPeriod || 7) && inScope(entry?.['科目代碼'], entry?.['班級代碼'], entry);
    };
    const reportIsManualOnlyPeriod = period => typeof isManualOnlyPeriod === 'function'
      ? isManualOnlyPeriod(period)
      : period === 0 || period === 45;
    const reportCountedSchedule = entry => {
      const period = reportPeriod(entry);
       return inScope(entry?.['科目代碼'], entry?.['班級代碼'], entry) && (reportIsManualOnlyPeriod(period) || reportInScope(entry));
    };
    const isPatrol = entry => [entry?.['課堂屬性'], entry?.['班級代碼'], entry?.['科目代碼']]
      .some(value => String(value || '').trim().includes('巡堂'));
    const isLockedConsecutiveEntry = (entry, rows) => {
      if (!entry || isPatrol(entry)) return false;
      const classCode = String(entry['班級代碼'] || '').trim();
      const subjectCode = String(entry['科目代碼'] || '').trim();
      const day = parseInt(entry['星期'], 10);
      const period = parseInt(entry['節次'], 10);
      if (!classCode || !subjectCode || !Number.isFinite(day) || !Number.isFinite(period)) return false;
      const peers = (Array.isArray(rows) ? rows : []).filter(candidate =>
        candidate && !isPatrol(candidate) &&
        String(candidate['班級代碼'] || '').trim() === classCode &&
        String(candidate['科目代碼'] || '').trim() === subjectCode &&
        parseInt(candidate['星期'], 10) === day &&
        Number.isFinite(parseInt(candidate['節次'], 10))
      );
      if (peers.length < 2) return false;
      const periods = new Set(peers.map(candidate => parseInt(candidate['節次'], 10)));
      return peers.some(candidate => {
        if (String(candidate['是否鎖定'] || '').toUpperCase() !== 'TRUE') return false;
        const lockedPeriod = parseInt(candidate['節次'], 10);
        const start = Math.min(lockedPeriod, period);
        const end = Math.max(lockedPeriod, period);
        if (start === end) return periods.has(period - 1) || periods.has(period + 1);
        for (let current = start; current <= end; current++) {
          if (!periods.has(current)) return false;
        }
        return true;
      });
    };
    const reportTeacherTokens = value => {
      const fallback = value && typeof value === 'object' ? value['教師姓名'] : value;
      if (typeof getCellTeacherCodes === 'function') {
        const codes = getCellTeacherCodes(value && typeof value === 'object' ? value : { '教師姓名': value });
        if (codes.length > 0) return codes.map(code => String(code));
      }
      return String(fallback || '').split(/[,，、;；]/).map(code => code.trim()).filter(Boolean);
    };
    const reportTeacherIdentities = value => {
      const tokens = reportTeacherTokens(value);
      if (typeof resolveTeacherCodes !== 'function') return tokens;
      const identities = resolveTeacherCodes(value);
      return identities.length > 0 ? identities : tokens;
    };
    const reportTeacherKey = value => {
      const identities = reportTeacherIdentities(value);
      const teacher = identities.map(code => idx.teacherByCode?.[code]).find(Boolean);
      return teacher ? String(teacher['教師姓名'] || teacher['姓名'] || identities[0] || '') : String(identities[0] || value || '');
    };
    const reportCohortValues = value => {
      if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
      if (typeof value === 'number') return String(value).match(/.{3}/g) || [];
      return String(value || '').split(/[,，、]/).map(item => item.trim()).filter(Boolean);
    };
    const reportAllowedCombinedClassCohort = items => {
      if (typeof isAllowedCombinedClassCohort === 'function') return isAllowedCombinedClassCohort(items);
      if (typeof window !== 'undefined' && typeof window.isAllowedCombinedClassCohort === 'function') {
        return window.isAllowedCombinedClassCohort(items);
      }
      if (!Array.isArray(items) || items.length < 2) return false;
      const subjects = [...new Set(items.map(item => String(item.subjectCode || '').trim()).filter(Boolean))];
      const classes = items.map(item => String(item.classCode || '').trim()).filter(Boolean);
      if (subjects.length !== 1 || classes.length !== items.length || new Set(classes).size !== items.length) return false;
      if (items.every(item => item.isLocked === true)) return true;
      return (state.blockGroups || []).some(group => {
        const groupSubjects = reportCohortValues(group['科目清單'] || group['科目代碼']);
        const groupClasses = reportCohortValues(group['班級清單']);
        return groupSubjects.includes(subjects[0]) && classes.every(classCode => groupClasses.includes(classCode));
      });
    };
    const scopedSchedule = (Array.isArray(schedule) ? schedule : []).filter(reportInScope);
    const countedSchedule = (Array.isArray(schedule) ? schedule : []).filter(reportCountedSchedule);
    const auditSchedule = scopedSchedule.filter(entry => !ignoredScheduleIds.has(String(entry?.['課表ID'] || '').trim()));
    const required = new Map(), scheduled = new Map(), classSubjectRequired = new Map(), classSubjectScheduled = new Map();
    state.assignments.forEach(assignment => {
      const teacherCodes=reportTeacherTokens(assignment), classCode=String(assignment['班級代碼']||''), subjectCode=String(assignment['科目代碼']||'');
       if(!classCode||!subjectCode||!inScope(subjectCode, classCode)) return;
       const weekly=getAssignmentWeeklyValue(assignment, idx.subjectByCode[subjectCode], 3);
      const classSubjectKey=classCode+'|'+subjectCode;
      classSubjectRequired.set(classSubjectKey,(classSubjectRequired.get(classSubjectKey)||0)+weekly);
      if(teacherCodes.length === 0) return;
      teacherCodes.forEach(teacherCode => {
        const key=teacherCode+'|'+classCode+'|'+subjectCode;
        const item=required.get(key)||{teacherCode,classCode,subjectCode,required:0}; item.required+=weekly; required.set(key,item);
      });
    });
    countedSchedule.forEach(item=>{
      const classCode=String(item['班級代碼']||''), subjectCode=String(item['科目代碼']||'');
      reportTeacherIdentities(item).forEach(teacherCode=>{
        const key=teacherCode+'|'+classCode+'|'+subjectCode;
         if(required.has(key)) scheduled.set(key,(scheduled.get(key)||0)+getScheduleWeeklyUnits(item));
      });
      const classSubjectKey=classCode+'|'+subjectCode;
       if(classSubjectRequired.has(classSubjectKey)) classSubjectScheduled.set(classSubjectKey,(classSubjectScheduled.get(classSubjectKey)||0)+getScheduleWeeklyUnits(item));
    });
     const deficits=[]; required.forEach((item,key)=>{const placed=Math.min(item.required,scheduled.get(key)||0);if(item.required-placed>0.000001)deficits.push({...item,scheduled:placed,remaining:item.required-placed});});
    const violations=new Set(), classSlots=new Set(), teacherSlotItems=new Map(), teacherConsecutiveSlotItems=new Map(), roomSlotItems=new Map(), concurrent=new Map(), teacherDays=new Map(), teacherGradeDayCounts=new Map(), teacherGradePeriodGrades=new Map(), classSubjectDays=new Map(), classSubjectDayCounts=new Map(), classSubjectDayPeriods=new Map(), classSubjectDayEntries=new Map(), classDaySubjects=new Map();
    const classAuditSlots = new Map();
    const teacherAuditSlots = new Map();
    const roomAuditSlots = new Map();
    const subjectAuditSlots = new Map();
    const subjectRulesCache = new Map();
    const effectiveWeekTypes = entry => {
      const period = reportPeriod(entry);
      const attr = String(entry?.['課堂屬性'] || '').trim();
      if (period !== 8) return ['全週'];
      return attr === '單週' || attr === '雙週' ? [attr] : ['單週', '雙週'];
    };
    const getRulesForSubjectClass = (subjectCode, classCode, grade) => {
      const cacheKey = subjectCode + '|' + classCode + '|' + grade;
      if (subjectRulesCache.has(cacheKey)) return subjectRulesCache.get(cacheKey);
      const sourceRules = (idx.rulesBySubject && idx.__built)
        ? (idx.rulesBySubject[subjectCode] || [])
        : (state.subjectRules || []);
      const matched = sourceRules.filter(rule => ruleAppliesToSubjectAndClass(rule, subjectCode, classCode, grade));
      subjectRulesCache.set(cacheKey, matched);
      return matched;
    };
    auditSchedule.forEach(item=>{
      const classCode=String(item['班級代碼']||''),teacherCodes=reportTeacherTokens(item),subjectCode=String(item['科目代碼']||''),day=parseInt(item['星期'],10),period=reportPeriod(item),weekType=reportWeekType(item);
       if(!classCode||!subjectCode||!Number.isFinite(day)||!Number.isFinite(period))return;
       const cls=idx.classByCode[classCode],grade=cls?String(cls['年級']||'').trim():String(classCode).charAt(0);
       const rules=getRulesForSubjectClass(subjectCode,classCode,grade);
       const isMandatory=rules.some(rule=>rule['規則類型']==='必排'&&getRuleDaysPeriods(rule).some(slot=>slot.day===day&&slot.period===period));
       const classSubjectKey=classCode+'|'+subjectCode;
       const isLocked=String(item['是否鎖定']||'').toUpperCase()==='TRUE';
       const roomCode=String(idx.subjectByCode[subjectCode]?.['所屬教室代碼']||'').trim();
       const isVirtualClass=!!String(idx.classByCode[classCode]?.['是否虛擬班']||'').toUpperCase().match(/^(TRUE|1|YES|是)$/);
       const itemTeacherIdentities=reportTeacherIdentities(item);
       const ck=classCode+'|'+day+'|'+period+'|'+weekType;if(classSlots.has(ck))violations.add('班級衝堂：'+classCode+' 星期'+day+'第'+period+'節'+(weekType!=='全週'?'（'+weekType+'）':''));classSlots.add(ck);
       effectiveWeekTypes(item).forEach(effWeek => {
         const classAuditKey = classCode + '|' + day + '|' + period + '|' + effWeek;
         (classAuditSlots.get(classAuditKey) || classAuditSlots.set(classAuditKey, []).get(classAuditKey)).push(item);
         itemTeacherIdentities.forEach(tcId => {
           const teacherAuditKey = tcId + '|' + day + '|' + period + '|' + effWeek;
           (teacherAuditSlots.get(teacherAuditKey) || teacherAuditSlots.set(teacherAuditKey, []).get(teacherAuditKey)).push({
             classCode,
             subjectCode,
             isLocked
           });
         });
         if (roomCode) {
           const roomAuditKey = roomCode + '|' + day + '|' + period + '|' + effWeek;
           (roomAuditSlots.get(roomAuditKey) || roomAuditSlots.set(roomAuditKey, []).get(roomAuditKey)).push({ classCode, subjectCode });
         }
         if (!isVirtualClass) {
           const subjectAuditKey = subjectCode + '|' + day + '|' + period + '|' + effWeek;
           subjectAuditSlots.set(subjectAuditKey, (subjectAuditSlots.get(subjectAuditKey) || 0) + 1);
         }
       });
      teacherCodes.forEach(rawTeacherCode=>{
        const teacherCode = reportTeacherKey(rawTeacherCode);
        if(!teacherCode) return;
         const tk=teacherCode+'|'+day+'|'+period+'|'+weekType;
        const items=teacherSlotItems.get(tk)||[];
        const mainTeacher = teacherCodes[0] || '';
        items.push({
          classCode,
           subjectCode,
           isLocked,
           isMandatory,
           isMainTeacher: reportTeacherKey(mainTeacher) === teacherCode
         });
         teacherSlotItems.set(tk,items);
         if (!ignoredTeacherConsecutiveIds.has(String(item['課表ID'] || '').trim())) {
           const consecutiveItems = teacherConsecutiveSlotItems.get(tk) || [];
           consecutiveItems.push(items[items.length - 1]);
           teacherConsecutiveSlotItems.set(tk, consecutiveItems);
         }
        if(reportTeacherIdentities(rawTeacherCode).some(identity=>idx.blockSet.has(identity+'|'+day+'|'+period))) violations.add('教師不排課違規：'+teacherCode+' 星期'+day+'第'+period+'節');
         if(period<=7){const days=teacherDays.get(teacherCode)||[[],[],[],[],[]];if(!days[day-1].includes(period))days[day-1].push(period);teacherDays.set(teacherCode,days);}
        if((classSubjectRequired.get(classCode+'|'+subjectCode)||0)===1&&grade){
          const gradeMap=teacherGradeDayCounts.get(teacherCode)||new Map();
          const dayCounts=gradeMap.get(grade)||new Map();
          dayCounts.set(day,(dayCounts.get(day)||0)+1);
          gradeMap.set(grade,dayCounts);teacherGradeDayCounts.set(teacherCode,gradeMap);
          const periodMap=teacherGradePeriodGrades.get(teacherCode)||new Map();
          const dayPeriods=periodMap.get(day)||new Map();
          const periodGrades=dayPeriods.get(period)||new Set();
          periodGrades.add(grade);
          dayPeriods.set(period,periodGrades);periodMap.set(day,dayPeriods);teacherGradePeriodGrades.set(teacherCode,periodMap);
        }
      });
       const alternateCourse = isAlternateAssignment(classCode, subjectCode) || isAlternateEntry(item);
       if(isHelper(subjectCode)&&period!==8)violations.add('課後輔導節次錯誤：'+subjectCode+'（'+classCode+'）');
       if(!isHelper(subjectCode)&&!alternateCourse&&period===8)violations.add('一般課程排入第8節：'+subjectCode+'（'+classCode+'）');
       if(alternateCourse&&(period!==8||weekType==='全週'))violations.add('0.5 節單雙週課程必須排在第8節單週或雙週：'+subjectCode+'（'+classCode+'）');
       if(roomCode){const roomKey=roomCode+'|'+day+'|'+period+'|'+weekType;const roomItems=roomSlotItems.get(roomKey)||[];roomItems.push({classCode,subjectCode});roomSlotItems.set(roomKey,roomItems);}
       if(rules.some(rule=>rule['規則類型']==='禁排'&&getRuleDaysPeriods(rule).some(slot=>slot.day===day&&slot.period===period)))violations.add('科目禁排違規：'+subjectCode+'（'+classCode+'）');
      const must=rules.filter(rule=>rule['規則類型']==='必排');if(must.length&&!must.some(rule=>getRuleDaysPeriods(rule).some(slot=>slot.day===day&&slot.period===period)))violations.add('科目必排違規：'+subjectCode+'（'+classCode+'）');
       const concKey=subjectCode+'|'+day+'|'+period+'|'+weekType;concurrent.set(concKey,(concurrent.get(concKey)||0)+1);
        const classDayKey=classCode+'|'+day;if(!classDaySubjects.has(classDayKey))classDaySubjects.set(classDayKey,new Set());classDaySubjects.get(classDayKey).add(subjectCode);
        const spreadKey=classCode+'|'+subjectCode;if(!classSubjectDays.has(spreadKey))classSubjectDays.set(spreadKey,new Set());classSubjectDays.get(spreadKey).add(day);
        const dayKey=spreadKey+'|'+day+'|'+weekType;classSubjectDayCounts.set(dayKey,(classSubjectDayCounts.get(dayKey)||0)+1);if(!classSubjectDayPeriods.has(dayKey))classSubjectDayPeriods.set(dayKey,new Set());classSubjectDayPeriods.get(dayKey).add(period);if(!classSubjectDayEntries.has(dayKey))classSubjectDayEntries.set(dayKey,[]);classSubjectDayEntries.get(dayKey).push(item);
     });
     classAuditSlots.forEach((items, key) => {
       if (items.length > 1) violations.add('班級衝堂：' + key.replace(/\|/g, '／'));
     });
      teacherAuditSlots.forEach((items, key) => {
        if (items.length < 2 || reportAllowedCombinedClassCohort(items)) return;
        const parts = key.split('|');
        const detail = items.map(item => item.subjectCode + '（' + item.classCode + '）').join('／');
        violations.add('教師衝堂：' + parts[0] + ' 星期' + parts[1] + '第' + parts[2] + '節（' + parts[3] + '）：' + detail);
      });
     roomAuditSlots.forEach((items, key) => {
       const roomCode = key.split('|')[0];
       const capacity = parseInt(idx.roomByCode?.[roomCode]?.['容量'] || '1', 10) || 1;
       if (items.length > capacity) violations.add('教室衝突：' + key.replace(/\|/g, '／') + '（' + items.length + '/' + capacity + '）');
     });
     subjectAuditSlots.forEach((count, key) => {
       const subjectCode = key.split('|')[0];
       const maximum = parseInt(idx.subjectByCode?.[subjectCode]?.['同時最多班數'] || '0', 10) || 0;
       if (maximum > 0 && count > maximum) violations.add('科目同時班數超限：' + key.replace(/\|/g, '／') + '（' + count + '/' + maximum + '）');
     });
      teacherSlotItems.forEach((items,key)=>{
        if(items.length<2)return;
        if(reportAllowedCombinedClassCohort(items))return;
         const parts=key.split('|'),teacherCode=parts[0],day=parts[1],period=parts[2],weekType=parts[3],detail=items.map(item=>item.subjectCode+'（'+item.classCode+'）').join('／');
         violations.add('教師衝堂：'+teacherCode+' 星期'+day+'第'+period+'節'+(weekType!=='全週'?'（'+weekType+'）':'')+'：'+detail);
      });
      const hardTeacherPeriods=new Map();
      teacherConsecutiveSlotItems.forEach((items,key)=>{
        if (!items.length) return;
         const parts=key.split('|'),teacherCode=parts[0],day=Number(parts[1]),period=Number(parts[2]),weekType=parts[3];
         if(!teacherCode||!Number.isInteger(day)||day<1||day>5||!Number.isInteger(period)||period<1||period>8)return;
         const teacherWeekKey=teacherCode+'|'+weekType;
         if(!hardTeacherPeriods.has(teacherWeekKey))hardTeacherPeriods.set(teacherWeekKey,new Map());
         const byDay=hardTeacherPeriods.get(teacherWeekKey);
        if(!byDay.has(day))byDay.set(day,new Set());
        byDay.get(day).add(period);
      });
      hardTeacherPeriods.forEach((byDay,teacherWeekKey)=>{
        const teacherParts=teacherWeekKey.split('|'),teacherCode=teacherParts[0],weekType=teacherParts[1];
        const teacher=idx.teacherByCode?.[teacherCode]||(state.teachers||[]).find(item=>String(item['教師姓名']||item['姓名']||'').trim()===teacherCode)||{};
        const maximum=parseInt(teacher['最大連堂節數']||'2',10)||2;
        if(maximum<=0||maximum>=8)return;
        for(let day=1;day<=5;day++){
          const periods=byDay.get(day)||new Set();
          for(let start=1;start<=8-maximum;start++){
            let exceeds=true;
            for(let period=start;period<=start+maximum;period++)if(!periods.has(period)){exceeds=false;break;}
            if(exceeds){
              violations.add('教師連堂超限：'+teacherCode+' 星期'+day+'第'+start+'至第'+(start+maximum)+'節'+(weekType!=='全週'?'（'+weekType+'）':'')+'（上限'+maximum+'）');
              break;
            }
          }
        }
      });
      let teacherExclusiveSoftViolations=0;
      (state.teacherExclusives||[]).forEach(rule=>{
       const teacherA=reportTeacherKey(rule['教師A']),teacherB=reportTeacherKey(rule['教師B']);
       if(!teacherA||!teacherB)return;
        for(let day=1;day<=5;day++)for(let period=1;period<=8;period++)for(const weekType of (period===8?['單週','雙週']:['全週'])){
          const keyA=teacherA+'|'+day+'|'+period+'|'+weekType,keyB=teacherB+'|'+day+'|'+period+'|'+weekType;
         const itemsA=teacherSlotItems.get(keyA)||[],itemsB=teacherSlotItems.get(keyB)||[],combined=[...itemsA,...itemsB];
         const subjects=[...new Set(combined.map(item=>item.subjectCode).filter(Boolean))];
         const mandatoryException=combined.length>0&&subjects.length===1&&combined.every(item=>item.isMandatory);
          if(itemsA.length>0&&itemsB.length>0&&!mandatoryException){
            if(allowSoftTeacherExclusives)teacherExclusiveSoftViolations++;
            else violations.add('教師互斥違規：'+teacherA+'／'+teacherB+' 星期'+day+'第'+period+'節');
          }
       }
     });
     const reportGroupList=value=>{
      if(Array.isArray(value))return value.map(item=>String(item).trim()).filter(Boolean);
     if(typeof value==='number')return String(value).match(/.{3}/g)||[];
       return String(value||'').split(/[,，]/).map(item=>item.trim()).filter(Boolean);
     };
      const reportBindMembers=group=>{
       if(typeof getConfiguredBindMembers==='function')return getConfiguredBindMembers(group);
       const classCodes=reportGroupList(group['班級清單']),subjectCodes=reportGroupList(group['科目清單']||group['科目代碼']),members=[];
       classCodes.forEach(classCode=>{
        const assignedSubjects=subjectCodes.filter(subjectCode=>(state.assignments||[]).some(assignment=>String(assignment['班級代碼']||'').trim()===classCode&&String(assignment['科目代碼']||'').trim()===subjectCode));
        (assignedSubjects.length?assignedSubjects:subjectCodes).forEach(subjectCode=>members.push({classCode,subjectCode}));
       });
       return members;
      };
      (state.blockGroups||[]).forEach(group=>{
        const members=reportBindMembers(group);
        const classCodes=[...new Set(members.map(member=>String(member.classCode||'').trim()).filter(Boolean))];
        if(classCodes.length<2)return;
        const membersByClass=new Map();
        members.filter(member=>inScope(member.subjectCode)).forEach(member=>{
          if(!membersByClass.has(member.classCode))membersByClass.set(member.classCode,new Set());
          membersByClass.get(member.classCode).add(member.subjectCode);
        });
        const activeClassCodes=[...membersByClass.keys()];
        if(activeClassCodes.length<2)return;
        const signatures=activeClassCodes.map(classCode=>{
          const subjects=membersByClass.get(classCode);
           const slots=[...new Set(scopedSchedule.filter(item=>
             String(item['班級代碼']||'')===classCode&&subjects.has(String(item['科目代碼']||''))
           ).map(item=>parseInt(item['星期'],10)+'-'+parseInt(item['節次'],10)+'-'+reportWeekType(item)))].sort();
          return {classCode,signature:slots.join(','),label:slots.length?slots.join('、'):'未排'};
        });
        const canonical=signatures[0]?.signature||'';
        if(signatures.some(item=>item.signature!==canonical)){
          const groupLabel=String(group['群組名稱']||group['群組ID']||classCodes.join('、'));
          const details=signatures.map(item=>item.classCode+'：'+item.label).join('；');
          violations.add('綁班不同步：'+groupLabel+'（'+details+'）');
        }
      });
    roomSlotItems.forEach((items,key)=>{const roomCode=key.split('|')[0],capacity=parseInt(idx.roomByCode?.[roomCode]?.['容量']||'1',10)||1;if(items.length>capacity)violations.add('教室衝突：'+roomCode+' '+key.split('|')[1]+'-'+key.split('|')[2]+'（'+items.length+'/'+capacity+'）');});
    concurrent.forEach((count,key)=>{const subjectCode=key.split('|')[0],max=parseInt(idx.subjectByCode[subjectCode]?.['同時最多班數']||'0',10)||0;if(max>0&&count>max)violations.add('科目同時班數超限：'+key+'（'+count+'/'+max+'）');});
      classSubjectDayCounts.forEach((count,key)=>{if(count<2)return;const parts=key.split('|'),classCode=parts[0],subjectCode=parts[1],day=parts[2],weekType=parts[3],mandatorySlots=typeof getMandatoryRuleDaySlots==='function'?getMandatoryRuleDaySlots(subjectCode,classCode,Number(day)):[],allowedPeriods=new Set(mandatorySlots.map(slot=>Number(slot.period))),actualPeriods=classSubjectDayPeriods.get(key)||new Set(),entries=classSubjectDayEntries.get(key)||[],lockedBlockOnly=entries.length>0&&entries.every(entry=>isLockedConsecutiveEntry(entry,auditSchedule)),isAllowed=lockedBlockOnly||(mandatorySlots.length>1&&count===mandatorySlots.length&&actualPeriods.size===count&&[...actualPeriods].every(period=>allowedPeriods.has(period)));if(!isAllowed)violations.add('同班同科同日重複：'+classCode+' '+subjectCode+' 星期'+day+(weekType!=='全週'?'（'+weekType+'）':'')+'（'+count+'節）');});
      let teacherGaps=0,teacherImbalance=0,adjacentSubjectDays=0,teacherLongStreaks=0,teacherRepeatedPeriods=0,teacherAfternoonOverload=0,teacherPairSoftViolations=0,teacherCrossGradeSameDay=0,teacherCrossGradeAdjacent=0,subjectRelationSoftViolations=0;
     const subjectRelationSoftDetails=[];
     (state.subjectRelations||[]).forEach(rule=>{
       const pair=getSubjectRelationCodes(rule);
       if(pair.length!==2)return;
       classDaySubjects.forEach((subjects,key)=>{
         if(!subjects.has(pair[0])||!subjects.has(pair[1]))return;
         const parts=key.split('|'),classCode=parts[0],day=Number(parts[1]);
         const cls=idx.classByCode[classCode],grade=cls?String(cls['年級']||'').trim():String(classCode).charAt(0);
         if(!subjectRelationAppliesToClass(rule,classCode,grade))return;
          subjectRelationSoftViolations++;
         subjectRelationSoftDetails.push('科目關係同日：'+classCode+' 星期'+day+'「'+pair[0]+'／'+pair[1]+'」');
       });
    });
    teacherDays.forEach((days,teacherCode)=>{
      const counts=days.map(periods=>periods.length);teacherImbalance+=Math.max(...counts)-Math.min(...counts);
      const periodDays=[0,0,0,0,0,0,0],allPeriods=[];
      days.forEach((periods,d)=>{
        const sorted=[...new Set(periods)].sort((a,b)=>a-b);allPeriods.push(...sorted);sorted.forEach(period=>{if(period>=1&&period<=7)periodDays[period-1]++;});
        if (sorted.includes(1) && sorted.includes(7)) teacherPairSoftViolations++;
        if (sorted.includes(4) && sorted.includes(5)) teacherPairSoftViolations++;
        if(sorted.length>=2){const first=sorted[0],last=sorted[sorted.length-1],occupied=new Set(sorted);for(let p=first+1;p<last;p++)if(!occupied.has(p)&&!idx.blockSet.has(teacherCode+'|'+(d+1)+'|'+p))teacherGaps++;}
         const teacher=idx.teacherByCode?.[teacherCode]||(state.teachers||[]).find(item=>String(item['教師姓名']||item['姓名']||'').trim()===teacherCode)||{};
         const maximum=parseInt(teacher['最大連堂節數']||'2',10)||2;
         let streak=1;for(let i=1;i<sorted.length;i++){streak=sorted[i]===sorted[i-1]+1?streak+1:1;if(streak>maximum)teacherLongStreaks++;}
      });
      periodDays.forEach(count=>{teacherRepeatedPeriods+=Math.max(0,count-3);});
      const afternoonCount=allPeriods.filter(period=>period>=5&&period<=7).length;
      teacherAfternoonOverload+=Math.max(0,afternoonCount-Math.ceil(allPeriods.length*0.65));
    });
    teacherGradeDayCounts.forEach(gradeMap=>{
      if(gradeMap.size<2)return;
      gradeMap.forEach(dayCounts=>{
        const total=[...dayCounts.values()].reduce((sum,count)=>sum+count,0);
        const peak=Math.max(...dayCounts.values());
        teacherCrossGradeSameDay+=Math.max(0,total-peak);
      });
    });
    teacherGradePeriodGrades.forEach((dayMap,teacherCode)=>{
      if((teacherGradeDayCounts.get(teacherCode)?.size||0)<2)return;
      dayMap.forEach(periodMap=>{
        const periods=[...periodMap.keys()].sort((a,b)=>a-b);
        for(let i=0;i<periods.length-1;i++){
          if(periods[i+1]!==periods[i]+1)continue;
          const left=periodMap.get(periods[i]),right=periodMap.get(periods[i+1]);
          if(![...left].some(grade=>right.has(grade)))teacherCrossGradeAdjacent++;
        }
      });
    });
    let subjectMaxConsecutiveDays=0;
    classSubjectDays.forEach((set,key)=>{
      const days=[...set].sort((a,b)=>a-b);
      for(let i=1;i<days.length;i++)if(days[i]===days[i-1]+1)adjacentSubjectDays++;
      const parts=key.split('|'),classCode=parts[0],subjectCode=parts[1];
      const parsedMaxDays=parseInt(idx.subjectByCode[subjectCode]?.['最多連日']||'',10);
      const maxDays=Number.isFinite(parsedMaxDays)?parsedMaxDays:0;
      if(maxDays<=0||maxDays>=5)return;
      const weekly=classSubjectRequired.get(key)||0;
      const maxDistinctDays=5-Math.floor(5/(maxDays+1));
      if(weekly>maxDistinctDays)return;
      let streak=days.length?1:0;
      for(let i=1;i<days.length;i++){
        streak=days[i]===days[i-1]+1?streak+1:1;
        if(streak>maxDays){
          subjectMaxConsecutiveDays++;
          violations.add('科目連日超限：'+classCode+' '+subjectCode+'（最長'+streak+'日／上限'+maxDays+'日）');
          break;
        }
      }
    });
     const remainingLessons=[...classSubjectRequired.entries()].reduce((sum,[key,requiredWeekly])=>sum+Math.max(0,requiredWeekly-(classSubjectScheduled.get(key)||0)),0);
      const score=violations.size?0:Math.max(0,100-Math.min(50,remainingLessons*5)-Math.min(12,teacherGaps)-Math.min(10,adjacentSubjectDays)-Math.min(8,teacherImbalance)-Math.min(12,teacherLongStreaks*4)-Math.min(5,teacherRepeatedPeriods*2)-Math.min(3,teacherAfternoonOverload)-Math.min(6,teacherPairSoftViolations*2)-Math.min(6,teacherExclusiveSoftViolations*2)-Math.min(8,teacherCrossGradeSameDay*2)-Math.min(8,teacherCrossGradeAdjacent*2)-Math.min(12,subjectRelationSoftViolations*2));
    return {deficits,violations:[...violations],teacherGaps,teacherImbalance,adjacentSubjectDays,subjectMaxConsecutiveDays,teacherLongStreaks,teacherRepeatedPeriods,teacherAfternoonOverload,teacherPairSoftViolations,teacherExclusiveSoftViolations,teacherCrossGradeSameDay,teacherCrossGradeAdjacent,subjectRelationSoftViolations,subjectRelationSoftDetails,remainingLessons,score};
  };
if (typeof window !== 'undefined') window.buildAutoScheduleQualityReport = buildAutoScheduleQualityReport;

// ============================================================
// 自動排課共用純函式（自 executeAutoScheduleCore 提升至頂層）
// 這些函式不依賴閉包狀態，可獨立測試；內部呼叫點不需修改。
// ============================================================
const parsePriorityTokens = value => [...new Set(String(value || '').split(/[,，、;；\n]/).map(token => token.trim()).filter(Boolean))];
const autoAlternateWeekTypes = ['單週', '雙週'];
const getAutoEntryWeekTypes = entry => {
  const period = parseInt(entry?.['節次'], 10);
  const attr = String(entry?.['課堂屬性'] || '').trim();
  if (period !== 8) return ['全週'];
  return autoAlternateWeekTypes.includes(attr) ? [attr] : autoAlternateWeekTypes;
};
const hasWeekOverlap = (entry, weekType) => getAutoEntryWeekTypes(entry).includes(weekType);
const autoTeacherInput = lesson => lesson.teacherCodes?.length ? lesson.teacherCodes : lesson.teacherCode;
const getAutoClassGrade = classCode => {
  const cls = idx.classByCode[String(classCode)] || null;
  return String(cls?.['年級'] || String(classCode || '').charAt(0)).trim();
};
const getSubjectRoomCode = subjectCode => String(idx.subjectByCode[String(subjectCode)]?.['所屬教室代碼'] || '').trim();
const getSubjectRoomCapacity = subjectCode => {
  const roomCode = getSubjectRoomCode(subjectCode);
  const room = roomCode ? idx.roomByCode[roomCode] : null;
  return Math.max(1, parseInt(room?.['容量'] || '1', 10) || 1);
};
const parseAutoBindList = value => {
  if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean);
  if (typeof value === 'number') return String(value).match(/.{3}/g) || [];
  return String(value || '').split(/[,，、;；]/).map(item => item.trim()).filter(Boolean);
};
const getAutoBindSubjects = group => parseAutoBindList(group?.['科目清單'] || group?.['科目代碼']);
const getAutoBindClasses = group => parseAutoBindList(group?.['班級清單']);
const getAutoBindMemberKey = (classCode, subjectCode) => String(classCode || '').trim() + '|' + String(subjectCode || '').trim();
const coreSubjects = new Set(['國文', '數學', '英語', '理化', '生物', '自然', '歷史', '地理', '公民']);
const activitySubjects = new Set(['體育', '音樂', '視覺藝術', '表演藝術', '家政', '童軍', '資訊科技', '生活科技', '走讀建成生活圈', '文旅享繪', '活力建成']);
const autoTeacherCodesCache = new Map();
const autoTeacherCodesObjectCache = new WeakMap();
const getAutoTeacherCodes = value => {
  const isObject = value && typeof value === 'object';
  if (isObject && autoTeacherCodesObjectCache.has(value)) return autoTeacherCodesObjectCache.get(value);
  const stringKey = isObject ? '' : String(value ?? '');
  if (!isObject && autoTeacherCodesCache.has(stringKey)) return autoTeacherCodesCache.get(stringKey);
  const values = Array.isArray(value) ? value : [value];
  const codes = [];
  values.forEach(item => {
    const cell = item && typeof item === 'object' ? item : { '教師姓名': item };
    const parsed = getCellTeacherCodes(cell);
    if (parsed.length > 0) {
      codes.push(...parsed);
      return;
    }
    const fallback = item && typeof item === 'object' ? item['教師姓名'] : item;
    String(fallback || '').split(/[,，、;；]/).forEach(token => {
      const code = String(token || '').trim();
      if (code) codes.push(code);
    });
  });
  const result = [...new Set(codes)];
  if (isObject) autoTeacherCodesObjectCache.set(value, result);
  else autoTeacherCodesCache.set(stringKey, result);
  return result;
};

async function executeAutoScheduleCore(runOptions = {}) {
  const previewOnly = runOptions.previewOnly === true;
  const skipUiCommit = runOptions.skipUiCommit === true || previewOnly;
  const updateProgress = typeof runOptions.onProgress === 'function'
    ? runOptions.onProgress
    : (typeof globalThis !== 'undefined' && typeof globalThis.updateProgress === 'function' ? globalThis.updateProgress : () => {});
  const yieldToUI = typeof runOptions.yieldFn === 'function'
    ? runOptions.yieldFn
    : (typeof globalThis !== 'undefined' && typeof globalThis.yieldToUI === 'function' ? globalThis.yieldToUI : () => Promise.resolve());
  let providedConfig = runOptions.config && typeof runOptions.config === 'object' ? runOptions.config : null;
  if (!providedConfig && !skipUiCommit && typeof prepareAutoScheduleUiRun === 'function') {
    const uiPrep = await prepareAutoScheduleUiRun(runOptions);
    if (!uiPrep) return;
    providedConfig = uiPrep.config || {};
  }
  const getAutoScheduleIdentity = entry => {
    const id = String(entry?.['課表ID'] || '').trim();
    if (id) return 'id:' + id;
    return 'row:' + JSON.stringify([
      String(entry?.['班級代碼'] || ''), String(entry?.['星期'] || ''), String(entry?.['節次'] || ''),
      String(entry?.['科目代碼'] || ''), String(entry?.['教師姓名'] || ''), String(entry?.['課堂屬性'] || '')
    ]);
  };
  const originalSchedule = JSON.parse(JSON.stringify(state.schedule || []));
  const originalScheduleIds = [...new Set(originalSchedule
    .map(entry => String(entry?.['課表ID'] || '').trim())
    .filter(Boolean))];
  const originalScheduleKeys = new Set(originalSchedule.map(getAutoScheduleIdentity));
  const isOriginalAutoScheduleEntry = entry => originalScheduleKeys.has(getAutoScheduleIdentity(entry));
  const configuredBindMembersCache = new Map();
  const getConfiguredBindMembersForRun = group => {
    if (!configuredBindMembersCache.has(group)) configuredBindMembersCache.set(group, getConfiguredBindMembers(group));
    return configuredBindMembersCache.get(group);
  };
  const bindGroupClassesCache = new Map();
  const getBindGroupClasses = (subjectCode, classCode) => {
    const targetSubject = String(subjectCode || '').trim();
    const targetClass = String(classCode || '').trim();
    const cacheKey = targetSubject + '|' + targetClass;
    if (bindGroupClassesCache.has(cacheKey)) return bindGroupClassesCache.get(cacheKey);
    let result = null;
    for (const group of state.blockGroups || []) {
      const members = getConfiguredBindMembersForRun(group);
      const byClass = new Map();
      members.forEach(member => {
        if (!byClass.has(member.classCode)) byClass.set(member.classCode, []);
        byClass.get(member.classCode).push(member);
      });
      const targetMembers = byClass.get(targetClass) || [];
      const targetIndex = targetMembers.findIndex(member => member.subjectCode === targetSubject);
      if (targetIndex < 0) continue;
      const cohort = [...byClass.values()].map(items => items[targetIndex]).filter(Boolean);
      if (cohort.length >= 2) {
        result = [...new Set(cohort.map(member => member.classCode))];
        break;
      }
    }
    bindGroupClassesCache.set(cacheKey, result);
    return result;
  };
  const autoScheduleStartedAt = Date.now();
  const requestedTimeBudget = Number(runOptions.timeBudgetMs);
  const autoScheduleTimeBudgetMs = Number.isFinite(requestedTimeBudget) && requestedTimeBudget > 0
    ? Math.max(10000, Math.floor(requestedTimeBudget))
    : (previewOnly ? 120000 : 300000);
  const autoScheduleDeadline = autoScheduleStartedAt + autoScheduleTimeBudgetMs;
  let autoScheduleTimedOut = false;
  let autoScheduleQualityGraceActive = false;
  let autoScheduleQualityDeadline = autoScheduleDeadline;
  let repairBudgetExceeded = false;
  let repairOperationCount = 0;
  let repairOperationLimit = 0;
  let repairOperationReserve = 0;
  let repairGlobalReserveMs = 0;
  let neighborhoodRepairMoves = 0;
  let globalMatchingPasses = 0;
  let conflictGraphMoves = 0;
  const conflictGraphStats = { searches: 0, nodes: 0, candidates: 0 };
  const neighborhoodRepairStats = {
    attempts: 0,
    maxItems: 0,
    searchNodes: 0,
    candidateWipeouts: 0,
    searchFailures: 0,
    successes: 0
  };
  let localOptimizationCandidates = 0;
  let localOptimizationAttemptedMoves = 0;
  let localOptimizationRollbacks = 0;
  const autoTightClassCodes = new Set();
  const shouldStopAutoSchedule = phase => {
    const phaseName = String(phase || '排課');
    const isQualityPhase = autoScheduleQualityGraceActive &&
      (phaseName === 'local-optimization' || phaseName === 'subject-relation-optimization');
    if (autoScheduleTimedOut && !isQualityPhase) return true;
    const phaseDeadline = isQualityPhase ? autoScheduleQualityDeadline : autoScheduleDeadline;
    if (Date.now() < phaseDeadline) return false;
    autoScheduleTimedOut = true;
    console.warn('[AutoSchedule] 時間預算已用盡：' + phaseName + '，保留目前最佳合法課表。');
    updateProgress('時間預算已用盡，正在保留目前最佳合法課表…');
    return true;
  };
  const autoScheduleProfile = runOptions.profile === true
    ? { startedAt: autoScheduleStartedAt, current: 'prepare', phaseStartedAt: autoScheduleStartedAt, phases: {} }
    : null;
  const markAutoScheduleProfile = phase => {
    if (!autoScheduleProfile) return;
    const now = Date.now();
    autoScheduleProfile.phases[autoScheduleProfile.current] =
      (autoScheduleProfile.phases[autoScheduleProfile.current] || 0) + now - autoScheduleProfile.phaseStartedAt;
    autoScheduleProfile.current = phase;
    autoScheduleProfile.phaseStartedAt = now;
  };
  const readAutoScheduleProfile = () => {
    if (!autoScheduleProfile) return null;
    const now = Date.now();
    const phases = { ...autoScheduleProfile.phases };
    phases[autoScheduleProfile.current] =
      (phases[autoScheduleProfile.current] || 0) + now - autoScheduleProfile.phaseStartedAt;
    return { phases, totalMs: now - autoScheduleProfile.startedAt };
  };
  const formatAutoScheduleElapsed = () => {
    const elapsedSeconds = Math.max(0, (Date.now() - autoScheduleStartedAt) / 1000);
    if (elapsedSeconds < 60) return elapsedSeconds.toFixed(2) + ' 秒';
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = (elapsedSeconds - minutes * 60).toFixed(2).padStart(5, '0');
    return minutes + ' 分 ' + seconds + ' 秒';
  };
  const cfg = providedConfig || {};
  (cfg.tightClassCodes || []).forEach(code => autoTightClassCodes.add(String(code || '')));
  let autoStartPeriod = parseInt(cfg.autoStartPeriod ?? '1', 10);
  let autoEndPeriod = parseInt(cfg.autoEndPeriod ?? '7', 10);
  if (isManualOnlyPeriod(autoStartPeriod)) autoStartPeriod = 1;
  if (isManualOnlyPeriod(autoEndPeriod)) autoEndPeriod = 7;
  if (!Number.isFinite(autoStartPeriod) || autoStartPeriod < 1 || autoStartPeriod > 8) autoStartPeriod = 1;
  if (!Number.isFinite(autoEndPeriod) || autoEndPeriod < 1 || autoEndPeriod > 8) autoEndPeriod = 7;

  const optOnePerDay      = true;
  const optMorningCore = cfg.optMorningCore !== undefined ? Boolean(cfg.optMorningCore) : true;
  const optTeacherConsec = cfg.optTeacherConsec !== undefined ? Boolean(cfg.optTeacherConsec) : true;
  const optSmartSwap = cfg.optSmartSwap !== undefined ? Boolean(cfg.optSmartSwap) : true;
  const optRandomize = runOptions.randomize !== undefined ? Boolean(runOptions.randomize) : Boolean(cfg.optRandomize);
  const optP8Only = Boolean(cfg.optP8Only);
  const priorityTeacherInput = String(cfg.priorityTeacherInput || '').trim();
  const prioritySubjectInput = String(cfg.prioritySubjectInput || '').trim();
  const autoMode = String(cfg.autoMode || 'all');
  const randomSeedInput = runOptions.seed !== undefined ? String(runOptions.seed) : String(cfg.seed ?? '').trim();

  const priorityTeacherTokens = new Set(parsePriorityTokens(priorityTeacherInput));
  const prioritySubjectTokens = new Set(parsePriorityTokens(prioritySubjectInput));
  const parsedRandomSeed = Number.parseInt(randomSeedInput, 10);
  let randomState = Number.isFinite(parsedRandomSeed) ? (parsedRandomSeed >>> 0) : (Date.now() >>> 0);
  const nextAutoRandom = () => {
    randomState = (randomState * 1664525 + 1013904223) >>> 0;
    return randomState / 4294967296;
  };
  const AUTO_RANDOM_TOP_K = optRandomize ? 7 : 3;
  const AUTO_RANDOM_SCORE_TOLERANCE = optRandomize ? 8 : 3;
  const autoRandomTieBreak = () => optRandomize ? nextAutoRandom() : 0.5;
  const compareAutoCandidates = (left, right) => {
    const scoreDelta = (Number(right.score) || 0) - (Number(left.score) || 0);
    if (scoreDelta !== 0) return scoreDelta;
    return (Number(left.tieBreak) || 0.5) - (Number(right.tieBreak) || 0.5);
  };
  const getAutoCandidateSlot = candidate => ({
    day: candidate?.day ?? candidate?.dayR,
    period: candidate?.per ?? candidate?.perR ?? candidate?.period
  });
  const prioritizeAutoCandidates = (candidates, relationLessons = null, relationContextFactory = null, comparator = compareAutoCandidates) => {
    if (!Array.isArray(candidates) || candidates.length === 0) return [];
    const lessons = Array.isArray(relationLessons)
      ? relationLessons.filter(Boolean)
      : (relationLessons ? [relationLessons] : []);
    let prioritized = candidates.slice();
    if (lessons.length > 0 && typeof getSubjectRelationViolationCount === 'function') {
      const relationFree = prioritized.filter(candidate => {
        const context = typeof relationContextFactory === 'function'
          ? relationContextFactory(candidate)
          : null;
        const targetSchedule = context?.schedule || localSchedule;
        const targetLookup = context?.lookup || null;
        const { day, period } = getAutoCandidateSlot(candidate);
        return lessons.reduce((sum, lesson) => sum + getSubjectRelationViolationCount(
          lesson,
          day,
          period,
          targetSchedule,
          targetLookup
        ), 0) === 0;
      });
      // 科目關係仍是軟限制，但只要存在關係乾淨的合法候選，就優先選擇乾淨候選。
      if (relationFree.length > 0) prioritized = relationFree;
    }
    return prioritized.sort(comparator);
  };
  const selectAutoCandidate = (candidates, relationLessons = null) => {
    const prioritized = prioritizeAutoCandidates(candidates, relationLessons);
    if (prioritized.length === 0) return null;
    if (!optRandomize || prioritized.length === 1) return prioritized[0];
    const topScore = Number(prioritized[0].score) || 0;
    const frontier = prioritized
      .slice(0, AUTO_RANDOM_TOP_K)
      .filter(candidate => topScore - (Number(candidate.score) || 0) <= AUTO_RANDOM_SCORE_TOLERANCE);
    return frontier[Math.floor(nextAutoRandom() * frontier.length)] || prioritized[0];
  };

  if (optP8Only) {
    autoStartPeriod = 8;
    autoEndPeriod   = 8;
  }

  const autoTeacherIdentityCache = new Map();
  const resolveAutoTeacherCodes = value => {
    const codes = getAutoTeacherCodes(value);
    const key = codes.join('|');
    if (!autoTeacherIdentityCache.has(key)) {
      const resultSet = new Set(codes);
      codes.forEach(code => {
        const teacher = idx.teacherByCode[code];
        const name = teacher ? (teacher['教師姓名'] || teacher['姓名']) : '';
        if (name) resultSet.add(name);
        (state.teachers || []).forEach(t => {
          if ((t['教師姓名'] || t['姓名']) === code && t['教師姓名']) resultSet.add(t['教師姓名']);
        });
      });
      autoTeacherIdentityCache.set(key, [...resultSet]);
    }
    return autoTeacherIdentityCache.get(key);
  };
  const autoTeacherBlockCounts = new Map();
  idx.blockSet.forEach(slotKey => {
    const separator = String(slotKey).indexOf('|');
    if (separator <= 0) return;
    const teacherCode = String(slotKey).slice(0, separator);
    autoTeacherBlockCounts.set(teacherCode, (autoTeacherBlockCounts.get(teacherCode) || 0) + 1);
  });
  const getAutoTeacherConstraintScore = value => {
    const identities = new Set(resolveAutoTeacherCodes(value));
    return [...identities].reduce((total, identity) => total + (autoTeacherBlockCounts.get(identity) || 0), 0);
  };
  const autoTeacherMatches = (cell, teacherValue) => {
    const wanted = resolveAutoTeacherCodes(teacherValue);
    const actual = resolveAutoTeacherCodes(cell);
    // 協同配課必須主教師與每位協同教師都存在，不能只命中其中一位就算完成。
    return wanted.length > 0 && wanted.every(code => actual.includes(code));
  };
  const canonicalAutoTeacherCode = value => {
    const identities = resolveAutoTeacherCodes(value);
    const teacher = identities.map(code => idx.teacherByCode[code]).find(Boolean);
    return teacher ? String(teacher['教師姓名'] || teacher['姓名'] || identities[0] || '') : String(identities[0] || '');
  };
  const autoTeacherValue = lesson => {
    if (lesson.teacherValue !== undefined) return lesson.teacherValue;
    const codes = getAutoTeacherCodes(lesson.teacherCode);
    return codes.length > 1 ? codes : (codes[0] || '');
  };
  const getAutoManualPriorityScore = (subjectCode, teacherValue) => {
    const subjectPriority = prioritySubjectTokens.has(String(subjectCode || '').trim()) ? 2 : 0;
    const teacherPriority = resolveAutoTeacherCodes(teacherValue)
      .some(identity => priorityTeacherTokens.has(String(identity).trim())) ? 2 : 0;
    return subjectPriority + teacherPriority;
  };
  const autoTeacherExclusivePeers = new Map();
  const addAutoTeacherExclusivePeers = (sourceCodes, peerCodes) => {
    sourceCodes.forEach(source => {
      if (!autoTeacherExclusivePeers.has(source)) autoTeacherExclusivePeers.set(source, new Set());
      peerCodes.forEach(peer => autoTeacherExclusivePeers.get(source).add(peer));
    });
  };
  (state.teacherExclusives || []).forEach(rule => {
    const teacherA = resolveAutoTeacherCodes(rule['教師A']);
    const teacherB = resolveAutoTeacherCodes(rule['教師B']);
    addAutoTeacherExclusivePeers(teacherA, teacherB);
    addAutoTeacherExclusivePeers(teacherB, teacherA);
  });
  const weeklyTargetByClassSubject = new Map();
  const getAutoBindMembers = group => getConfiguredBindMembersForRun(group);
  const activeAssignments = (state.assignments || []).filter(assignment => !isPreplannedCourse(assignment['課程屬性']));
  const assignmentWeeklyByClassSubject = buildAutoAssignmentWeeklyIndex(activeAssignments, idx.subjectByCode);
  const expandAutoBindGroupCohorts = group => {
    const members = getAutoBindMembers(group);
    const byClass = new Map();
    members.forEach(member => {
      if (!byClass.has(member.classCode)) byClass.set(member.classCode, []);
      byClass.get(member.classCode).push(member);
    });
    const maxCohorts = Math.max(0, ...[...byClass.values()].map(items => items.length));
    const parentId = String(group['群組ID'] || group['群組名稱'] || '');
    const cohorts = [];
    for (let cohortIndex = 0; cohortIndex < maxCohorts; cohortIndex++) {
      const cohortMembers = [...byClass.values()].map(items => items[cohortIndex]).filter(Boolean);
      if (cohortMembers.length < 2) continue;
      cohorts.push({
        ...group,
        '群組ID': parentId + '|C' + cohortIndex,
        '群組名稱': String(group['群組名稱'] || parentId) + '／第' + (cohortIndex + 1) + '組',
        '科目清單': [...new Set(cohortMembers.map(member => member.subjectCode))].join(','),
        '班級清單': [...new Set(cohortMembers.map(member => member.classCode))].join(','),
        __bindParentGroup: group,
        __bindCohortIndex: cohortIndex
      });
    }
    return cohorts;
  };
  const getAssignmentWeeklyForBind = (classCode, subjectCode) => {
    return assignmentWeeklyByClassSubject.get(String(classCode || '').trim() + '|' + String(subjectCode || '').trim()) || 0;
  };
  const bindWeeklyMismatchByKey = new Map();
  const bindDefinitionErrors = [];
  const invalidBindGroups = new Set();
  (state.blockGroups || []).forEach(group => {
    const groupSubjects = [...new Set(getAutoBindSubjects(group))];
    const groupClasses = getAutoBindClasses(group);
    if (groupSubjects.length === 0 || groupClasses.length < 2) return;
    const weeklyByClass = groupClasses.map(classCode => ({
      classCode,
      weekly: groupSubjects.reduce((total, subjectCode) => total + getAssignmentWeeklyForBind(classCode, subjectCode), 0)
    }));
    if (!weeklyByClass.some(item => item.weekly > 0)) return;
    const weeklyValues = new Set(weeklyByClass.map(item => item.weekly));
    if (weeklyValues.size <= 1) return;
    const groupKey = String(group['群組ID'] || group['群組名稱'] || groupClasses.join(','));
    const detail = weeklyByClass.map(item => item.classCode + '：' + item.weekly + ' 節').join('、');
    bindDefinitionErrors.push('綁班「' + groupKey + '」各班合計每週節數不一致：' + detail);
    invalidBindGroups.add(group);
    groupClasses.forEach(classCode => groupSubjects.forEach(subjectCode => {
      bindWeeklyMismatchByKey.set(String(classCode) + '|' + subjectCode, true);
    }));
  });
  // 同一科目與年級會在候選時段評估中查詢數百次；一次展開後重用。
  const applicableRuleCache = new Map();
  const applicableSubjectRelationCache = new Map();
  const AUTO_SUBJECT_RELATION_PENALTY = 120;
  const normalizeAutoSubjectCode = value => String(value || '').trim();
  const normalizeAutoRuleType = value => String(value || '').trim();
  const isMandatoryAutoRule = rule => normalizeAutoRuleType(rule?.['規則類型']) === '必排';
  const isForbiddenAutoRule = rule => normalizeAutoRuleType(rule?.['規則類型']) === '禁排';
  function getApplicableRules(subjectCode, classCode) {
    const cls = idx.classByCode[String(classCode)] || null;
    const grade = cls ? String(cls['年級'] || String(classCode || '').charAt(0)).trim() : String(classCode || '').charAt(0);
    const normalizedSubjectCode = normalizeAutoSubjectCode(subjectCode);
    const normalizedClassCode = String(classCode || '').trim();
    const key = normalizedSubjectCode + '|' + normalizedClassCode + '|' + grade;
    if (!applicableRuleCache.has(key)) {
      const entries = state.subjectRules
        .filter(rule => {
          return getRuleSubjectCodes(rule).includes(normalizedSubjectCode) &&
            ruleAppliesToClass(rule, normalizedClassCode, grade);
        })
        .map(rule => ({ rule, slots: getRuleDaysPeriods(rule) }));
      applicableRuleCache.set(key, entries);
    }
    return applicableRuleCache.get(key);
  }
  const getApplicableSubjectRelations = (subjectCode, classCode) => {
    const normalizedSubjectCode = normalizeAutoSubjectCode(subjectCode);
    const normalizedClassCode = String(classCode || '').trim();
    const cls = idx.classByCode[normalizedClassCode] || null;
    const grade = cls ? String(cls['年級'] || normalizedClassCode.charAt(0)).trim() : normalizedClassCode.charAt(0);
    const key = normalizedSubjectCode + '|' + normalizedClassCode + '|' + grade;
    if (!applicableSubjectRelationCache.has(key)) {
      const entries = (idx.subjectRelationsBySubject?.[normalizedSubjectCode] || [])
        .filter(relation => subjectRelationAppliesToClass(relation, normalizedClassCode, grade))
        .map(relation => ({ relation, otherSubjectCode: getSubjectRelationOtherCode(relation, normalizedSubjectCode) }))
        .filter(entry => entry.otherSubjectCode);
      applicableSubjectRelationCache.set(key, entries);
    }
    return applicableSubjectRelationCache.get(key);
  };
  const getSubjectRelationViolationCount = (lesson, day, period, targetSchedule = localSchedule, targetLookup = null) => {
    if (!lesson || !Number.isFinite(Number(day))) return 0;
    const relationLookup = targetLookup || buildScheduleLookup(targetSchedule);
    return getApplicableSubjectRelations(lesson.subjectCode, lesson.classCode)
      .filter(entry => (relationLookup.classSubjectDays.get(
        String(lesson.classCode) + '|' + entry.otherSubjectCode + '|' + day
      ) || 0) > 0).length;
  };
  const getAutoSubjectConstraintScore = (subjectCode, subject, classCode, maxConsecDays) => {
    const maxConcurrent = parseInt(subject?.['同時最多班數'] || '0', 10) || 0;
     const weekly = getSubjectWeeklyValue(subject, 0);
    const roomCode = String(subject?.['所屬教室代碼'] || '').trim();
    const rules = getApplicableRules(subjectCode, classCode);
    const ruleScore = rules.reduce((sum, entry) => {
      if (isMandatoryAutoRule(entry.rule)) return sum + 4;
      if (isForbiddenAutoRule(entry.rule)) return sum + 3;
      return sum + 1;
    }, 0);
    let score = 0;
    if (maxConsecDays > 0 && maxConsecDays < 5) score += (5 - maxConsecDays) * 4;
    if (maxConcurrent > 0) score += Math.max(1, 6 - Math.min(maxConcurrent, 5)) * 3;
    if (roomCode) score += 2;
    if (weekly > 4) score += Math.min(6, weekly - 4);
    return score + Math.min(16, ruleScore);
  };

  // 「全量自動」會真正重建所選範圍內的未凍結課程，避免只補洞而被舊排法卡死。
  // 分階段模式則保留手動調整結果：第一階段只重建必排與綁班，第二階段只補一般課。
    const alternateClassSubjectKeys = new Set(activeAssignments
     .filter(assignment => isAlternateWeeklyValue(getAssignmentWeeklyValue(assignment, idx.subjectByCode?.[String(assignment['科目代碼'] || '').trim()], 3)))
     .map(assignment => String(assignment['班級代碼'] || '').trim() + '|' + String(assignment['科目代碼'] || '').trim()));
   const isAlternateWeekScheduleEntry = entry => {
     const attr = String(entry?.['課堂屬性'] || '').trim();
     return parseInt(entry?.['節次'], 10) === 8 && (attr === '單週' || attr === '雙週');
   };
   const isAlternateClassSubject = (classCode, subjectCode) => alternateClassSubjectKeys.has(
     String(classCode || '').trim() + '|' + String(subjectCode || '').trim()
   );
   const isEntryInsideAutoRange = entry => {
     const period = parseInt(entry?.['節次'], 10);
     if (!Number.isFinite(period) || isManualOnlyPeriod(period) || period < autoStartPeriod || period > autoEndPeriod) return false;
      const helper = String(entry?.['科目代碼'] || '').trim().endsWith('輔');
     const alternate = isAlternateWeekScheduleEntry(entry) || isAlternateClassSubject(entry?.['班級代碼'], entry?.['科目代碼']);
     if (optP8Only) return period === 8 && (helper || alternate);
     if (period === 8) return autoEndPeriod >= 8 && (helper || alternate);
     return !helper && !alternate && period <= 7;
  };
  const entryHasMandatoryRule = entry => getApplicableRules(
    String(entry?.['科目代碼'] || ''),
    String(entry?.['班級代碼'] || '')
  ).some(item => isMandatoryAutoRule(item.rule));
  const shouldRebuildExistingEntry = entry => {
     if (!isEntryInsideAutoRange(entry) || isPreplannedScheduleEntry(entry) || isFrozenScheduleEntry(entry) || isLockedConsecutiveScheduleEntry(entry, state.schedule)) return false;
    if (autoMode === 'all') return true;
    if (autoMode === 'phase1') {
      return !!getBindGroupClasses(entry['科目代碼'], entry['班級代碼']) || entryHasMandatoryRule(entry);
    }
    return false;
  };
  const scheduleSeed = state.schedule.filter(entry => !shouldRebuildExistingEntry(entry));
  const scheduleEntriesByClassSubject = buildAutoScheduleEntriesByClassSubject(scheduleSeed);
  const rebuiltExistingCount = state.schedule.length - scheduleSeed.length;
  if (rebuiltExistingCount > 0) {
    console.log('[AutoSchedule] 重新最佳化 ' + rebuiltExistingCount + ' 節未凍結課程。');
  }

  // 1. 統計所有配課中，剩餘未安排的課程 tokens
  let pendingLessons = [];

  activeAssignments.forEach(asgn => {
    const classCode   = String(asgn['班級代碼']);
    const subjectCode = normalizeAutoSubjectCode(asgn['科目代碼']);
    const teacherCode = String(asgn['教師姓名']);
    const sub         = idx.subjectByCode[subjectCode];
    const cls         = idx.classByCode[classCode];
    const isVirtual   = cls && cls['是否虛擬班'] === 'TRUE';

     const totalWeekly = getAssignmentWeeklyValue(asgn, sub, 3);
     const isAlternateWeek = isAlternateWeeklyValue(totalWeekly);
     const isP8Lesson = isAlternateWeek || isHelperSubjectCode(subjectCode);
    const classSubjectKey = classCode + '|' + subjectCode;
    weeklyTargetByClassSubject.set(classSubjectKey, (weeklyTargetByClassSubject.get(classSubjectKey) || 0) + totalWeekly);

      const existingCount = (scheduleEntriesByClassSubject.get(classSubjectKey) || [])
        .filter(entry => !isPreplannedScheduleEntry(entry) && (!teacherCode || autoTeacherMatches(entry, teacherCode)))
        .reduce((total, entry) => total + getScheduleWeeklyUnits(entry), 0);

    // 配課完成度必須以「班級＋科目＋教師」核對；否則同班同科目由不同教師授課時，會誤算成已排。
     const remainingNeeded = Math.max(0, totalWeekly - existingCount);
     const lessonCount = isAlternateWeek
       ? (remainingNeeded > 0.000001 ? 1 : 0)
       : Math.ceil(Math.max(0, remainingNeeded) - 0.000001);
    const maxConsecDays = parseSubjectMaxConsecutiveDays(sub);

    // 計算教師限制分數（解析代碼與姓名，限制越多越優先）
    const teacherConstraintScore = getAutoTeacherConstraintScore(teacherCode);

    // 計算教師可用時段數量（越少越難排，優先處理）
    let teacherAvailableSlots = 5 * (autoEndPeriod - autoStartPeriod + 1);
    if (teacherCode) {
      const teacherIdentities = new Set(resolveAutoTeacherCodes(teacherCode));
      teacherAvailableSlots = 0;
      for (let d = 1; d <= 5; d++) {
        for (let p = autoStartPeriod; p <= autoEndPeriod; p++) {
          const teacherSlotKeys = [...teacherIdentities].map(identity => identity + '|' + d + '|' + p);
          const blocked = teacherSlotKeys.some(slotKey => idx.blockSet.has(slotKey));
          const hasConflict = teacherSlotKeys.some(tk => (idx.schedByTeacherSlot[tk] || []).length > 0);
          if (!blocked && !hasConflict) teacherAvailableSlots++;
        }
      }
    }
    // 檢查此科目是否有必排規則（依班級年級過濾）
    const mustRulesForClass = getApplicableRules(subjectCode, classCode)
      .filter(entry => isMandatoryAutoRule(entry.rule));
    const hasMustRule = mustRulesForClass.length > 0;
    const mustRuleSlots = [];
    mustRulesForClass.forEach(entry => {
      entry.slots.forEach(({day, period}) => mustRuleSlots.push({day, per: period}));
    });
    const subjectConstraintScore = getAutoSubjectConstraintScore(subjectCode, sub, classCode, maxConsecDays);
    const priorityScore = getAutoManualPriorityScore(subjectCode, teacherCode);
     for (let i = 0; i < lessonCount; i++) {
       pendingLessons.push({
        id: `auto_${classCode}_${subjectCode}_${i}`,
        classCode,
        subjectCode,
        teacherCode,
        teacherCodes: getAutoTeacherCodes(teacherCode),
        teacherValue: getAutoTeacherCodes(teacherCode).length > 1 ? getAutoTeacherCodes(teacherCode) : teacherCode,
         totalWeekly,
         weeklyUnit: isAlternateWeek ? 0.5 : 1,
         isAlternateWeek,
         isP8Lesson,
        maxConsecDays,
        subjectConstraintScore,
        priorityScore,
        isVirtual,
        isCore: coreSubjects.has(subjectCode),
        isActivity: activitySubjects.has(subjectCode),
        teacherConstraintScore,
         teacherAvailableSlots,
         hasMustRule,
         mustRuleSlots,
         randomOrder: autoRandomTieBreak()
       });
    }
  });

  // 科目屬性判斷
  const isHelperSubject = (code) => String(code || '').trim().endsWith('輔');

  // 1-7 節模式：不把第八節課程放進排課；第八節專用模式同時處理課輔與 0.5 節單雙週課程。
  if (optP8Only) {
    pendingLessons = pendingLessons.filter(l => l.isP8Lesson);
  } else if (autoEndPeriod <= 7) {
    pendingLessons = pendingLessons.filter(l => !l.isP8Lesson);
  }

  // 分階段排課篩選
  if (autoMode === 'phase1') {
    // 第一階段：只排有「必排規則」或「綁班群組」的課程
    pendingLessons = pendingLessons.filter(l =>
      l.hasMustRule || !!getBindGroupClasses(l.subjectCode, l.classCode)
    );
    console.log(`[Phase 1] 篩選後待排: ${pendingLessons.length} 節（必排+綁班）`);
  } else if (autoMode === 'phase2') {
    // 第二階段：跳過必排與綁班（應已手動調整），只補排一般課
    pendingLessons = pendingLessons.filter(l =>
      !l.hasMustRule && !getBindGroupClasses(l.subjectCode, l.classCode)
    );
    console.log(`[Phase 2] 篩選後待排: ${pendingLessons.length} 節（一般課程）`);
  }

  if (pendingLessons.length === 0) {
    const rangeLabel = optP8Only ? '第 8 節（課後輔導）' : `第 ${autoStartPeriod}~${autoEndPeriod} 節`;
    const runProfile = readAutoScheduleProfile();
    const emptyQuality = typeof buildAutoScheduleQualityReport === 'function'
      ? buildAutoScheduleQualityReport({ schedule: scheduleSeed, optP8Only, autoEndPeriod, onePerDay: optOnePerDay, ignoreTeacherConsecutiveIds: originalScheduleIds })
      : null;
    const emptyResult = {
      schedule: scheduleSeed.map(entry => ({ ...entry })),
      quality: emptyQuality,
      nothingPending: true,
      pendingCount: 0,
      localOptimizationMoves: 0,
      neighborhoodRepairMoves,
      conflictGraphMoves,
      timedOut: autoScheduleTimedOut,
      timeBudgetMs: autoScheduleTimeBudgetMs,
      repairBudgetExceeded,
      failureDetails: [],
      failList: [],
      bindFailureLessons: [],
      bindDefinitionErrors: [],
      originalScheduleIds: [...originalScheduleIds],
      autoStartPeriod,
      autoEndPeriod,
      optP8Only,
      optOnePerDay,
      rangeLabel,
      elapsedMs: Date.now() - autoScheduleStartedAt,
      profile: runProfile
    };
    if (skipUiCommit || typeof applySingleAutoScheduleResultUi !== 'function') return emptyResult;
    return applySingleAutoScheduleResultUi(emptyResult);
  }

  await yieldToUI();
  updateProgress(`準備排課 (${pendingLessons.length} 節待排)`);

  // 2. 多重優先級排序（先尊重手動優先，其次依實際限制緊迫度）
  pendingLessons.sort((a, b) => {
    // 必排規則優先處理
    if (a.hasMustRule && !b.hasMustRule) return -1;
    if (!a.hasMustRule && b.hasMustRule) return 1;
    // 使用者指定優先教師／科目，但不改變任何硬限制
    if ((a.priorityScore || 0) !== (b.priorityScore || 0)) {
      return (b.priorityScore || 0) - (a.priorityScore || 0);
    }
    // 科目限制越多越優先：最多連日、同時上限、專用教室與時段規則均納入
    if ((a.subjectConstraintScore || 0) !== (b.subjectConstraintScore || 0)) {
      return (b.subjectConstraintScore || 0) - (a.subjectConstraintScore || 0);
    }
    // 最多連日小的優先（更嚴格的先排）
    const aMaxConsecDays = a.maxConsecDays > 0 ? a.maxConsecDays : Number.MAX_SAFE_INTEGER;
    const bMaxConsecDays = b.maxConsecDays > 0 ? b.maxConsecDays : Number.MAX_SAFE_INTEGER;
    if (aMaxConsecDays !== bMaxConsecDays) return aMaxConsecDays - bMaxConsecDays;
    // 教師可用時段少的優先（更難排）
    if (a.teacherAvailableSlots !== b.teacherAvailableSlots) {
      return a.teacherAvailableSlots - b.teacherAvailableSlots;
    }
    // 虛擬班優先
    if (a.isVirtual && !b.isVirtual) return -1;
    if (!a.isVirtual && b.isVirtual) return 1;
    // 教師限制多的優先
    if (a.teacherConstraintScore !== b.teacherConstraintScore) {
      return b.teacherConstraintScore - a.teacherConstraintScore;
    }
    // 核心科目優先
     if (a.isCore && !b.isCore) return -1;
     if (!a.isCore && b.isCore) return 1;
     return (Number(a.randomOrder) || 0.5) - (Number(b.randomOrder) || 0.5);
  });

  // 3. 回溯與高階軟性啟發式評分求解器
  let localSchedule = JSON.parse(JSON.stringify(scheduleSeed));
  let successCount = 0;
  let failList = [];
  const bindFailureLessons = [];
  const bindFailureDiagnostics = new Map();
  const autoConflictWeights = {
    class: new Map(),
    teacher: new Map(),
    subject: new Map(),
    room: new Map(),
    reason: new Map()
  };
  const autoConflictStats = { failureEvents: 0 };
  const bumpAutoConflictWeight = (map, key, amount) => {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) return;
    map.set(normalizedKey, (map.get(normalizedKey) || 0) + amount);
  };
  const getAutoConflictPressure = lesson => {
    if (!lesson) return 0;
    let pressure = 0;
    pressure += (autoConflictWeights.class.get(String(lesson.classCode || '').trim()) || 0) * 2;
    pressure += (autoConflictWeights.subject.get(String(lesson.subjectCode || '').trim()) || 0) * 1.5;
    getAutoTeacherCodes(autoTeacherInput(lesson)).forEach(teacherCode => {
      pressure += (autoConflictWeights.teacher.get(canonicalAutoTeacherCode(teacherCode)) || 0);
    });
    const roomCode = getSubjectRoomCode(lesson.subjectCode);
    pressure += (autoConflictWeights.room.get(roomCode) || 0);
    pressure += (autoConflictWeights.reason.get(String(lesson.failureReason || '').trim()) || 0);
    return pressure;
  };
  const getAutoDynamicDifficulty = (lesson, availableSlots) => {
    const domainSize = Math.max(0, Number(availableSlots) || 0);
    const pressure = getAutoConflictPressure(lesson);
    return domainSize === 0 ? 100000 + pressure : (1 + pressure * 2) / domainSize;
  };
  const recordAutoFailurePressure = (lesson, reason) => {
    if (!lesson) return;
    autoConflictStats.failureEvents++;
    bumpAutoConflictWeight(autoConflictWeights.class, lesson.classCode, 1);
    bumpAutoConflictWeight(autoConflictWeights.subject, lesson.subjectCode, 1);
    getAutoTeacherCodes(autoTeacherInput(lesson)).forEach(teacherCode => {
      bumpAutoConflictWeight(autoConflictWeights.teacher, canonicalAutoTeacherCode(teacherCode), 1);
    });
    bumpAutoConflictWeight(autoConflictWeights.room, getSubjectRoomCode(lesson.subjectCode), 1);
    bumpAutoConflictWeight(autoConflictWeights.reason, reason, 1);
    lesson.dynamicPressure = getAutoConflictPressure(lesson);
  };
  const autoFailureLabels = {
    'bind-group-no-common-slot': '綁班沒有共同可用時段',
    'bind-group-weekly-mismatch': '綁班每週節數不一致，整組拒絕排課',
    'no-legal-slot': '沒有合法可用格位',
    'class-zero-slack-no-legal-slot': '班級零彈性，沒有可用格位',
    'cascade-no-legal-slot': '連鎖搬動後仍沒有合法格位',
    'mandatory-evicted': '必排挪出後待重排'
  };
  const markAutoFailure = (lesson, reason) => {
    if (lesson) {
      lesson.failureReason = reason;
      recordAutoFailurePressure(lesson, reason);
    }
    failList.push(lesson);
  };
  const requeuedLessons = [];

  // 凍結層：鎖課與正確落在必排時段的課程，任何自動流程都不可移動。
  // 綁班只在群組同步階段維持同時段，後續一般最佳化可以調整。
  function isFrozenAutoEntry(schedEntry) {
    if (!schedEntry) return false;
    if (String(schedEntry['是否鎖定'] || '').toUpperCase() === 'TRUE') return true;
    if (isLockedConsecutiveScheduleEntry(schedEntry, localSchedule)) return true;
    if (schedEntry.__isMustRule) return true;
    const subCode = String(schedEntry['科目代碼'] || '');
    const clsCode = String(schedEntry['班級代碼'] || '');
    const day = parseInt(schedEntry['星期'], 10);
    const per = parseInt(schedEntry['節次'], 10);
    return getApplicableRules(subCode, clsCode).some(entry =>
      isMandatoryAutoRule(entry.rule) &&
      entry.slots.some(slot => slot.day === day && slot.period === per)
    );
  }
  // 舊流程仍使用此名稱，保留別名但不再把綁班視為凍結課。
  function isMustPlacedCourse(schedEntry) {
    return isFrozenAutoEntry(schedEntry);
  }
  function isBindAutoEntry(schedEntry) {
    if (!schedEntry) return false;
    if (schedEntry.__isBindGroup) return true;
    return !!getBindGroupClasses(
      String(schedEntry['科目代碼'] || ''),
      String(schedEntry['班級代碼'] || '')
    );
  }
  const frozenEntrySnapshot = new Map();
  let frozenSnapshotSeed = 0;
  localSchedule.forEach((entry, index) => {
    if (!isFrozenAutoEntry(entry)) return;
    const rawId = String(entry['課表ID'] || '').trim();
    const keyBase = rawId || `auto-frozen-${++frozenSnapshotSeed}`;
    const key = frozenEntrySnapshot.has(keyBase) ? `${keyBase}-${index}` : keyBase;
    Object.defineProperty(entry, '__autoFrozenKey', { value: key, enumerable: false, configurable: true });
    frozenEntrySnapshot.set(key, {
      id: rawId,
      entry: { ...entry },
      classCode: String(entry['班級代碼'] || ''),
      subjectCode: String(entry['科目代碼'] || ''),
      teacher: getAutoTeacherCodes(entry).sort().join('|'),
      day: parseInt(entry['星期'], 10),
      period: parseInt(entry['節次'], 10)
    });
  });
  function restoreFrozenEntries() {
    let restoredAny = false;
    frozenEntrySnapshot.forEach((before, key) => {
      let index = localSchedule.findIndex(entry => entry.__autoFrozenKey === key);
      if (index < 0 && before.id) {
        index = localSchedule.findIndex(entry => String(entry['課表ID'] || '').trim() === before.id);
      }
      const restored = { ...before.entry };
      Object.defineProperty(restored, '__autoFrozenKey', { value: key, enumerable: false, configurable: true });
      if (index < 0) localSchedule.push(restored);
      else localSchedule[index] = restored;
      restoredAny = true;
    });
    if (restoredAny) markLocalScheduleChanged();
  }
  function verifyFrozenEntries() {
    restoreFrozenEntries();
    const violations = [];
    frozenEntrySnapshot.forEach((before, key) => {
      const current = localSchedule.find(entry => entry.__autoFrozenKey === key);
      if (!current) {
        violations.push(`凍結課程遺失：${before.classCode}／${before.subjectCode}`);
        return;
      }
      const after = {
        classCode: String(current['班級代碼'] || ''),
        subjectCode: String(current['科目代碼'] || ''),
        teacher: getAutoTeacherCodes(current).sort().join('|'),
        day: parseInt(current['星期'], 10),
        period: parseInt(current['節次'], 10)
      };
      if (before.classCode !== after.classCode || before.subjectCode !== after.subjectCode || before.teacher !== after.teacher || before.day !== after.day || before.period !== after.period) {
        violations.push(`凍結課程位置變更：${before.classCode}／${before.subjectCode}（原星期${before.day}第${before.period}節）`);
      }
    });
    return violations;
  }
  function makeAutoLessonFromScheduleEntry(entry, suffix = 'requeue') {
    const classCode = String(entry?.['班級代碼'] || '');
    const subjectCode = String(entry?.['科目代碼'] || '');
    const teacherCodes = getAutoTeacherCodes(entry);
    const teacherCode = teacherCodes[0] || String(entry?.['教師姓名'] || '');
    const subject = idx.subjectByCode[subjectCode];
    const applicableRules = getApplicableRules(subjectCode, classCode);
    const mustRuleSlots = [];
    applicableRules
      .filter(entryRule => isMandatoryAutoRule(entryRule.rule))
      .forEach(entryRule => entryRule.slots.forEach(({day, period}) => mustRuleSlots.push({day, per: period})));
    return {
      id: `auto_${suffix}_${classCode}_${subjectCode}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      classCode,
      subjectCode,
      teacherCode,
      teacherCodes,
      teacherValue: teacherCodes.length > 1 ? teacherCodes : teacherCode,
      totalWeekly: weeklyTargetByClassSubject.get(classCode + '|' + subjectCode) || 1,
      weeklyUnit: isAlternateWeekScheduleEntry(entry) ? 0.5 : 1,
      isAlternateWeek: isAlternateWeekScheduleEntry(entry) || isAlternateClassSubject(classCode, subjectCode),
      isP8Lesson: isAlternateWeekScheduleEntry(entry) || isAlternateClassSubject(classCode, subjectCode) || isHelperSubjectCode(subjectCode),
      weekType: isAlternateWeekScheduleEntry(entry) ? String(entry['課堂屬性'] || '').trim() : '',
      maxConsecDays: parseSubjectMaxConsecutiveDays(subject),
      subjectConstraintScore: getAutoSubjectConstraintScore(subjectCode, subject, classCode, parseSubjectMaxConsecutiveDays(subject)),
      priorityScore: getAutoManualPriorityScore(subjectCode, teacherCodes),
      isVirtual: String(entry?.['課堂屬性'] || '') === '抽離' || !!idx.classByCode[classCode]?.['是否虛擬班'],
      isCore: coreSubjects.has(subjectCode),
      isActivity: activitySubjects.has(subjectCode),
      teacherConstraintScore: getAutoTeacherConstraintScore(teacherCodes),
      teacherAvailableSlots: 0,
      hasMustRule: mustRuleSlots.length > 0,
      mustRuleSlots,
      randomOrder: autoRandomTieBreak()
    };
  }
  let localScheduleMutationVersion = 0;
  let localScheduleLookupCache = null;
  let localScheduleLookupCacheTarget = null;
  let localScheduleLookupCacheVersion = -1;
  const hasCurrentLocalScheduleLookup = () =>
    localScheduleLookupCache &&
    localScheduleLookupCacheTarget === localSchedule &&
    localScheduleLookupCacheVersion === localScheduleMutationVersion;
  const markLocalScheduleChanged = () => {
    localScheduleMutationVersion++;
    localScheduleLookupCache = null;
    localScheduleLookupCacheTarget = null;
  };
  const addScheduleLookupEntry = (scheduleLookup, item) => {
    const classCode = String(item['班級代碼'] || '');
    const subjectCode = String(item['科目代碼'] || '');
    const attr = String(item['課堂屬性'] || '');
    const isPatrol = isPatrolScheduleEntry(item);
    const day = parseInt(item['星期'], 10);
    const period = parseInt(item['節次'], 10);
    if (classCode) scheduleLookup.classSlots.add(classCode + '|' + day + '|' + period);
    const slotKey = day + '|' + period;
    if (!scheduleLookup.entriesBySlot.has(slotKey)) scheduleLookup.entriesBySlot.set(slotKey, []);
    scheduleLookup.entriesBySlot.get(slotKey).push(item);
    if (isManualOnlyPeriod(period)) return;
    if (classCode && Number.isFinite(day) && Number.isFinite(period) && day >= 1 && day <= 5 && period >= autoStartPeriod && period <= autoEndPeriod) {
      scheduleLookup.classActiveEntryCounts.set(classCode, (scheduleLookup.classActiveEntryCounts.get(classCode) || 0) + getScheduleWeeklyUnits(item));
    }
    const weekTypes = period === 8
      ? ((attr === '單週' || attr === '雙週') ? [attr] : ['單週', '雙週'])
      : ['全週'];
    if (classCode) weekTypes.forEach(weekType => scheduleLookup.classWeekSlots.add(classCode + '|' + day + '|' + period + '|' + weekType));
    const teacherTokens = getAutoTeacherCodes(item);
    const tCodes = resolveAutoTeacherCodes(item);
    const includeInAutoTeacherConsecutive = !isOriginalAutoScheduleEntry(item);
    tCodes.forEach(tc => {
      if (tc) scheduleLookup.teacherSlots.add(tc + '|' + day + '|' + period);
      if (tc) weekTypes.forEach(weekType => scheduleLookup.teacherWeekSlots.add(tc + '|' + day + '|' + period + '|' + weekType));
      if (tc && subjectCode !== '不排課' && attr !== '不排課') {
        const dayKey = tc + '|' + day;
        if (!scheduleLookup.teacherDayPeriods.has(dayKey)) scheduleLookup.teacherDayPeriods.set(dayKey, new Set());
        scheduleLookup.teacherDayPeriods.get(dayKey).add(period);
        if (includeInAutoTeacherConsecutive) {
          if (!scheduleLookup.teacherAutoDayPeriods.has(dayKey)) scheduleLookup.teacherAutoDayPeriods.set(dayKey, new Set());
          scheduleLookup.teacherAutoDayPeriods.get(dayKey).add(period);
        }
      }
    });
    teacherTokens.forEach(teacherToken => {
      const teacherKey = canonicalAutoTeacherCode(teacherToken);
      if (!teacherKey) return;
       if (classCode && Number.isFinite(day)) {
         const classTeacherKey = classCode + '|' + teacherKey;
         if (!scheduleLookup.classTeacherDays.has(classTeacherKey)) scheduleLookup.classTeacherDays.set(classTeacherKey, new Set());
         scheduleLookup.classTeacherDays.get(classTeacherKey).add(day);
       }
       const teacherDayKey = teacherKey + '|' + day;
       if (!scheduleLookup.teacherDayEntries.has(teacherDayKey)) scheduleLookup.teacherDayEntries.set(teacherDayKey, []);
       scheduleLookup.teacherDayEntries.get(teacherDayKey).push(item);

       let stats = scheduleLookup.teacherStats.get(teacherKey);
      if (!stats) {
        stats = {
          entryCount: 0,
          afternoonCount: 0,
          dailyCounts: [0, 0, 0, 0, 0],
          dayPeriods: new Map(),
          periodDays: new Map(),
          gradeDayCounts: new Map(),
          grades: new Set(),
          gradeSlots: new Map()
        };
        scheduleLookup.teacherStats.set(teacherKey, stats);
      }

      const grade = getAutoClassGrade(classCode);
      if (grade) stats.grades.add(grade);
      if (Number.isFinite(day) && Number.isFinite(period)) {
        const gradeSlotKey = day + '|' + period;
        if (!stats.gradeSlots.has(gradeSlotKey)) stats.gradeSlots.set(gradeSlotKey, new Set());
        if (grade) stats.gradeSlots.get(gradeSlotKey).add(grade);
      }

      const weeklyTarget = weeklyTargetByClassSubject.get(classCode + '|' + subjectCode);
      if (day >= 1 && day <= 5 && weeklyTarget === 1 && grade) {
        if (!stats.gradeDayCounts.has(grade)) stats.gradeDayCounts.set(grade, new Map());
        const gradeDays = stats.gradeDayCounts.get(grade);
        gradeDays.set(day, (gradeDays.get(day) || 0) + 1);
      }

      // 評分中的教師統計只看第 1～7 節，與原 teacherEntries 篩選一致。
      if (period > 7 || !Number.isFinite(period)) return;
      stats.entryCount++;
      if (period >= 5 && period <= 7) stats.afternoonCount++;
      if (day >= 1 && day <= 5) {
        stats.dailyCounts[day - 1]++;
        if (!stats.dayPeriods.has(day)) stats.dayPeriods.set(day, new Set());
        stats.dayPeriods.get(day).add(period);
        if (!stats.periodDays.has(period)) stats.periodDays.set(period, new Set());
        stats.periodDays.get(period).add(day);
      }
    });
    if (!isPatrol && subjectCode) {
      const key = subjectCode + '|' + day + '|' + period;
      scheduleLookup.subjectSlots.set(key, (scheduleLookup.subjectSlots.get(key) || 0) + 1);
      weekTypes.forEach(weekType => {
        const weekKey = subjectCode + '|' + day + '|' + period + '|' + weekType;
        scheduleLookup.subjectWeekSlots.set(weekKey, (scheduleLookup.subjectWeekSlots.get(weekKey) || 0) + 1);
      });
    }
    if (!isPatrol && classCode && subjectCode) {
      const key = classCode + '|' + subjectCode + '|' + day;
      scheduleLookup.classSubjectDays.set(key, (scheduleLookup.classSubjectDays.get(key) || 0) + 1);
      weekTypes.forEach(weekType => {
        const weekKey = classCode + '|' + subjectCode + '|' + day + '|' + weekType;
        scheduleLookup.classSubjectWeekDays.set(weekKey, (scheduleLookup.classSubjectWeekDays.get(weekKey) || 0) + 1);
      });
    }
    const roomCode = getSubjectRoomCode(subjectCode);
    if (!isPatrol && roomCode) {
      const roomKey = roomCode + '|' + day + '|' + period;
      scheduleLookup.roomSlots.set(roomKey, (scheduleLookup.roomSlots.get(roomKey) || 0) + 1);
      weekTypes.forEach(weekType => {
        const roomWeekKey = roomCode + '|' + day + '|' + period + '|' + weekType;
        scheduleLookup.roomWeekSlots.set(roomWeekKey, (scheduleLookup.roomWeekSlots.get(roomWeekKey) || 0) + 1);
      });
    }
  };
  const appendLocalSchedule = (...entries) => {
    const canUpdateLookup = hasCurrentLocalScheduleLookup();
    localSchedule.push(...entries);
    localScheduleMutationVersion++;
    if (canUpdateLookup) {
      entries.forEach(entry => addScheduleLookupEntry(localScheduleLookupCache, entry));
      localScheduleLookupCacheVersion = localScheduleMutationVersion;
    } else {
      localScheduleLookupCache = null;
      localScheduleLookupCacheTarget = null;
    }
  };
  const removeLocalScheduleAt = index => {
    localSchedule.splice(index, 1);
    markLocalScheduleChanged();
  };
  const insertLocalScheduleAt = (index, entry) => {
    localSchedule.splice(index, 0, entry);
    markLocalScheduleChanged();
  };
  const replaceLocalSchedule = entries => {
    localSchedule.length = 0;
    localSchedule.push(...entries);
    markLocalScheduleChanged();
  };
  const setLocalScheduleEntry = (index, entry) => {
    localSchedule[index] = entry;
    markLocalScheduleChanged();
  };
  function buildScheduleLookup(targetSched) {
    if (targetSched === localSchedule && targetSched === localScheduleLookupCacheTarget && localScheduleLookupCache && localScheduleLookupCacheVersion === localScheduleMutationVersion) {
      return localScheduleLookupCache;
    }
     const scheduleLookup = {
      classSlots: new Set(),
      classWeekSlots: new Set(),
      entriesBySlot: new Map(),
      teacherSlots: new Set(),
      teacherWeekSlots: new Set(),
      teacherDayEntries: new Map(),
      subjectSlots: new Map(),
      subjectWeekSlots: new Map(),
      classSubjectDays: new Map(),
      classSubjectWeekDays: new Map(),
      roomSlots: new Map(),
      roomWeekSlots: new Map(),
      teacherDayPeriods: new Map(),
      teacherAutoDayPeriods: new Map(),
      classActiveEntryCounts: new Map(),
      classTeacherDays: new Map(),
      teacherStats: new Map()
    };
     targetSched.forEach(item => addScheduleLookupEntry(scheduleLookup, item));
     if (targetSched === localSchedule) {
       localScheduleLookupCache = scheduleLookup;
       localScheduleLookupCacheTarget = targetSched;
       localScheduleLookupCacheVersion = localScheduleMutationVersion;
     }
     return scheduleLookup;
  }

  const selectAutoPlacementWeekType = (classCode, subjectCode, teacherValue, day, period, targetSched = localSchedule, scheduleLookup = null) => {
    if (parseInt(period, 10) !== 8) return '全週';
    const lookup = scheduleLookup || buildScheduleLookup(targetSched);
    const teacherIdentities = resolveAutoTeacherCodes(teacherValue);
    const roomCode = getSubjectRoomCode(subjectCode);
    const available = autoAlternateWeekTypes.filter(weekType => {
      if (lookup.classWeekSlots.has(String(classCode) + '|' + day + '|' + period + '|' + weekType)) return false;
      if (teacherIdentities.some(identity => lookup.teacherWeekSlots.has(identity + '|' + day + '|' + period + '|' + weekType))) return false;
      if (roomCode && (lookup.roomWeekSlots.get(roomCode + '|' + day + '|' + period + '|' + weekType) || 0) >= getSubjectRoomCapacity(subjectCode)) return false;
      return true;
    });
    return available[0] || '單週';
  };
  const getAutoLessonWeekType = (lesson, day, period, targetSched = localSchedule, scheduleLookup = null) => {
    if (parseInt(period, 10) !== 8 || !lesson?.isAlternateWeek) return '';
    return String(lesson.weekType || '').trim() || selectAutoPlacementWeekType(
      lesson.classCode, lesson.subjectCode, autoTeacherInput(lesson), day, period, targetSched, scheduleLookup
    );
  };
  const getAutoScheduleAttribute = (lesson, day, period, targetSched = localSchedule, scheduleLookup = null) => {
    const weekType = getAutoLessonWeekType(lesson, day, period, targetSched, scheduleLookup);
    return weekType || (lesson?.isVirtual ? '抽離' : '一般');
  };

  function canPlaceClassSubjectOnDay(clsCode, subCode, day, targetSched, scheduleLookup, weekType = '') {
    // 一般課程同班同科同日第二節禁止；明確必排連堂只放行指定節次數量。
    const prefix = String(clsCode) + '|' + String(subCode) + '|';
    const countForDay = targetDay => {
      if (scheduleLookup) {
        if (autoAlternateWeekTypes.includes(String(weekType || '').trim())) {
          return scheduleLookup.classSubjectWeekDays.get(prefix + targetDay + '|' + weekType) || 0;
        }
        return scheduleLookup.classSubjectDays.get(prefix + targetDay) || 0;
      }
      return targetSched.filter(s =>
        String(s['班級代碼']) === String(clsCode) && String(s['科目代碼']) === String(subCode) &&
        parseInt(s['星期'], 10) === targetDay &&
        (!autoAlternateWeekTypes.includes(String(weekType || '').trim()) || getAutoEntryWeekTypes(s).includes(weekType))
      ).length;
    };
    const currentDayCount = countForDay(day);
    const mandatoryDaySlots = getMandatoryRuleDaySlots(subCode, clsCode, day);
    return currentDayCount < (mandatoryDaySlots.length > 1 ? mandatoryDaySlots.length : 1);
  }
  function isSubjectMaxConsecutiveDaysFeasible(clsCode, subCode, maxDays) {
    const weeklyTarget = weeklyTargetByClassSubject.get(String(clsCode) + '|' + String(subCode)) || 0;
    if (weeklyTarget <= 0 || maxDays >= 5) return true;
    const maxDistinctDays = 5 - Math.floor(5 / (maxDays + 1));
    return weeklyTarget <= maxDistinctDays;
  }
  function canPlaceSubjectWithinMaxConsecutiveDays(clsCode, subCode, day, targetSched, scheduleLookup) {
    const subject = idx.subjectByCode[subCode];
    const maxDays = parseSubjectMaxConsecutiveDays(subject);
    if (maxDays <= 0 || maxDays >= 5) return true;
    if (!isSubjectMaxConsecutiveDaysFeasible(clsCode, subCode, maxDays)) return true;

    const prefix = String(clsCode) + '|' + String(subCode) + '|';
    const hasSubjectOnDay = targetDay => {
      if (scheduleLookup?.classSubjectDays) {
        return (scheduleLookup.classSubjectDays.get(prefix + targetDay) || 0) > 0;
      }
      return targetSched.some(entry =>
        String(entry['班級代碼']) === String(clsCode) &&
        String(entry['科目代碼']) === String(subCode) &&
        parseInt(entry['星期'], 10) === targetDay
      );
    };

    const days = [];
    for (let targetDay = 1; targetDay <= 5; targetDay++) {
      if (targetDay === day || hasSubjectOnDay(targetDay)) days.push(targetDay);
    }
    let streak = 1;
    for (let i = 1; i < days.length; i++) {
      streak = days[i] === days[i - 1] + 1 ? streak + 1 : 1;
      if (streak > maxDays) return false;
    }
    return true;
  }
  function countConsecutiveInLocal(sched, teacherCode, day, period, scheduleLookup = null) {
    if (!teacherCode) return 1;
    const dayN = parseInt(day, 10);
    const targetP = parseInt(period, 10);
    if (isManualOnlyPeriod(targetP)) return 1;
    const activePeriods = new Set();
    if (scheduleLookup?.teacherAutoDayPeriods) {
      resolveAutoTeacherCodes(teacherCode).forEach(identity => {
        const periods = scheduleLookup.teacherAutoDayPeriods.get(identity + '|' + dayN);
        if (periods) periods.forEach(value => activePeriods.add(value));
      });
    } else {
      sched.forEach(s => {
        if (!isOriginalAutoScheduleEntry(s) && autoTeacherMatches(s, teacherCode) && parseInt(s['星期'], 10) === dayN) {
          const sub  = String(s['科目代碼'] || '').trim();
          const attr = String(s['課堂屬性'] || '').trim();
          if (sub !== '不排課' && attr !== '不排課') {
            activePeriods.add(parseInt(s['節次'], 10));
          }
        }
      });
    }
    activePeriods.add(targetP);
    let before = 0, p = targetP - 1;
    while (p >= 1 && activePeriods.has(p)) { before++; p--; }
    let after = 0; p = targetP + 1;
    while (p <= 8 && activePeriods.has(p)) { after++; p++; }
    const streakAtTarget = before + after + 1;

    let maxStreakOnDay = 0, curStreak = 0;
    for (let p = 1; p <= 8; p++) {
      if (activePeriods.has(p)) { curStreak++; maxStreakOnDay = Math.max(maxStreakOnDay, curStreak); }
      else { curStreak = 0; }
    }
    return Math.max(streakAtTarget, maxStreakOnDay);
  }

  function isSlotValid(clsCode, subCode, tcCode, day, period, targetSched = localSchedule, scheduleLookup = null, validationOptions = {}) {
    if (isManualOnlyPeriod(period)) return false;
    if (period < autoStartPeriod || period > autoEndPeriod) return false;
    const isHelper = String(subCode || '').trim().endsWith('輔');
    const explicitWeekType = autoAlternateWeekTypes.includes(String(validationOptions.weekType || '').trim())
      ? String(validationOptions.weekType).trim()
      : '';
    const isAlternate = Boolean(explicitWeekType) || isAlternateClassSubject(clsCode, subCode);
    if (isHelper && period !== 8) return false;
    if (!isHelper && !isAlternate && period === 8) return false;
    if (isAlternate && period !== 8) return false;

    const targetWeekType = period === 8 && isAlternate
      ? (explicitWeekType || selectAutoPlacementWeekType(clsCode, subCode, tcCode, day, period, targetSched, scheduleLookup))
      : '';
    const targetWeekTypes = period === 8 ? (targetWeekType ? [targetWeekType] : autoAlternateWeekTypes) : ['全週'];

    const occupied = targetWeekTypes.some(weekType => scheduleLookup
      ? scheduleLookup.classWeekSlots.has(String(clsCode) + '|' + day + '|' + period + '|' + weekType)
      : targetSched.some(s => String(s['班級代碼']) === String(clsCode) && parseInt(s['星期'], 10) === day && parseInt(s['節次'], 10) === period && hasWeekOverlap(s, weekType)));
    if (occupied) return false;
    const roomCode = getSubjectRoomCode(subCode);
    if (roomCode) {
      const capacity = getSubjectRoomCapacity(subCode);
      const roomBlocked = targetWeekTypes.some(weekType => {
        const roomKey = roomCode + '|' + day + '|' + period + '|' + weekType;
        const roomCount = scheduleLookup
          ? (scheduleLookup.roomWeekSlots.get(roomKey) || 0)
          : targetSched.filter(s => !isPatrolScheduleEntry(s) && getSubjectRoomCode(s['科目代碼']) === roomCode && parseInt(s['星期'], 10) === day && parseInt(s['節次'], 10) === period && hasWeekOverlap(s, weekType)).length;
        return roomCount >= capacity;
      });
      if (roomBlocked) return false;
    }
    // 教師衝堂與不排課時段都是硬限制
    if (tcCode) {
      const teacherTokens = getAutoTeacherCodes(tcCode);
      for (const teacherToken of teacherTokens) {
        const identities = resolveAutoTeacherCodes(teacherToken);
        const conflict = targetWeekTypes.some(weekType => identities.some(identity => scheduleLookup
          ? scheduleLookup.teacherWeekSlots.has(identity + '|' + day + '|' + period + '|' + weekType)
          : targetSched.some(s => autoTeacherMatches(s, identity) && parseInt(s['星期'], 10) === day && parseInt(s['節次'], 10) === period && hasWeekOverlap(s, weekType))));
        const blocked = identities.some(identity => idx.blockSet.has(identity + '|' + day + '|' + period));
        if (conflict || blocked) {
          return false;
        }
      }
      // 教師互斥規則（自動排課引擎 - 解析代碼與多師）
      if (state.teacherExclusives && state.teacherExclusives.length > 0) {
        const myCodes = resolveAutoTeacherCodes(tcCode);
        for (const myTC of myCodes) {
          const peerCodes = autoTeacherExclusivePeers.get(myTC) || [];
          for (const peer of peerCodes) {
            const hasPeerLesson = targetWeekTypes.some(weekType => scheduleLookup
              ? scheduleLookup.teacherWeekSlots.has(peer + '|' + day + '|' + period + '|' + weekType)
              : targetSched.some(s => resolveAutoTeacherCodes(s['教師姓名']).includes(peer) && parseInt(s['星期'], 10) === day && parseInt(s['節次'], 10) === period && hasWeekOverlap(s, weekType)));
             if (hasPeerLesson) return false;
          }
        }
      }
    }

    const subj=idx.subjectByCode[subCode];
    const maxC=subj?parseInt(subj['同時最多班數']||'0',10):0;
    if (maxC > 0) {
      const exceeds = targetWeekTypes.some(weekType => {
        const key = String(subCode) + '|' + day + '|' + period + '|' + weekType;
        const count = scheduleLookup
          ? (scheduleLookup.subjectWeekSlots.get(key) || 0)
          : targetSched.filter(s => !isPatrolScheduleEntry(s) && String(s['科目代碼']) === String(subCode) && parseInt(s['星期'], 10) === day && parseInt(s['節次'], 10) === period && hasWeekOverlap(s, weekType)).length;
        return count >= maxC;
      });
      if (exceeds) return false;
    }

    const applicableRules=getApplicableRules(subCode,clsCode);
    if(applicableRules.some(entry=>isForbiddenAutoRule(entry.rule)&&entry.slots.some(slot=>slot.day===day&&slot.period===period)))return false;
    const mustRules=applicableRules.filter(entry=>isMandatoryAutoRule(entry.rule));
    if(mustRules.length&&!mustRules.some(entry=>entry.slots.some(slot=>slot.day===day&&slot.period===period)))return false;

    if (!canPlaceClassSubjectOnDay(clsCode, subCode, day, targetSched, scheduleLookup, targetWeekType)) {
      return false;
    }
    if (!canPlaceSubjectWithinMaxConsecutiveDays(clsCode, subCode, day, targetSched, scheduleLookup)) return false;

    if (optTeacherConsec && tcCode) {
      for (const teacherToken of getAutoTeacherCodes(tcCode)) {
        const teacherKey = canonicalAutoTeacherCode(teacherToken);
        const teacher = idx.teacherByCode[teacherKey];
        const maxConsec = teacher ? parseInt(teacher['最大連堂節數'] || '2', 10) : 2;
        const consec = countConsecutiveInLocal(targetSched, teacherToken, day, period, scheduleLookup);
        if (consec > maxConsec) return false;
      }
    }
    return true;
  }
  function evaluateSlotScore(lesson, day, period, includeRandom = true, scheduleLookup = null) {
    const lookup = scheduleLookup || buildScheduleLookup(localSchedule);
    let score = 100;

    // 必排時段加分（確保必排科目優先排入指定時段）
    const isMustRuleSlot = getApplicableRules(lesson.subjectCode, lesson.classCode).some(entry =>
      isMandatoryAutoRule(entry.rule) &&
      entry.slots.some(slot => slot.day === day && slot.period === period)
    );
    if (isMustRuleSlot) score += 200;

    // 核心學科溫和偏好上午，保留下午排課空間
    if (optMorningCore && lesson.isCore) {
      if (period >= 1 && period <= 4) score += 8;
      else if (period === 6 || period === 7) score -= 2;
    }

    // 活動課程僅保留極輕微下午偏好，避免整週集中在第 5～7 節。
    if (lesson.isActivity) {
      if (period >= 5 && period <= 7) score += 3;
      else if (period >= 1 && period <= 4) score += 1;
    }

    // 同科目分散排課
    const subjectDayPrefix = String(lesson.classCode) + '|' + String(lesson.subjectCode) + '|';
    const existingDays = [];
    for (let targetDay = 1; targetDay <= 5; targetDay++) {
      if ((lookup.classSubjectDays.get(subjectDayPrefix + targetDay) || 0) > 0) existingDays.push(targetDay);
    }

    if (existingDays.length > 0) {
      const minDiff = Math.min(...existingDays.map(d => Math.abs(d - day)));
      if (minDiff === 0) score -= 18;
      else if (minDiff === 1) score -= 16;
      else if (minDiff === 2) score += 24;
      else if (minDiff >= 3) score += 14;
    }

    // 科目關係是軟限制：同班同日遇到關聯科目時扣分，但不淘汰候選格位。
    const relationViolations = getSubjectRelationViolationCount(lesson, day, period, localSchedule, lookup);
    score -= relationViolations * AUTO_SUBJECT_RELATION_PENALTY;

    // 同一教師同一班級分散：儘量一天一節（跨科目也適用）
    const teacherCodes = getAutoTeacherCodes(autoTeacherInput(lesson));
    if (teacherCodes.length > 0) {
      for (const tcCode of teacherCodes) {
      const teacherClassDays = lookup.classTeacherDays.get(
        String(lesson.classCode) + '|' + canonicalAutoTeacherCode(tcCode)
      ) || new Set();
      if (teacherClassDays.size > 0) {
        const minDiff = Math.min(...[...teacherClassDays].map(d => Math.abs(d - day)));
        if (minDiff === 0) score -= 60;
        else if (minDiff === 1) score -= 20;
        else if (minDiff >= 2) score += 16;
      }
    }
    }

    // 跨年級教師的低週節數課程（每班每週一節）儘量按年級集中在同一天。
    // 這是評分偏好，不改變任何合法性判斷；同年級尚未有已排課程時不強行猜測日期。
    if (lesson.totalWeekly === 1 && teacherCodes.length > 0) {
      const candidateGrade = getAutoClassGrade(lesson.classCode);
      if (candidateGrade) {
        for (const tcCode of teacherCodes) {
          const teacherStats = lookup.teacherStats.get(canonicalAutoTeacherCode(tcCode));
          const gradeDayCounts = teacherStats?.gradeDayCounts || new Map();
          const teacherGrades = new Set(teacherStats?.grades || []);
          teacherGrades.add(candidateGrade);
          const sameGradeDayCounts = gradeDayCounts.get(candidateGrade);
          if (teacherGrades.size >= 2) {
            if (sameGradeDayCounts && sameGradeDayCounts.size > 0) {
              const sameDayCount = sameGradeDayCounts.get(day) || 0;
              const peakDayCount = Math.max(...sameGradeDayCounts.values());
              if (sameDayCount > 0) {
                score += 18 + Math.min(10, (sameDayCount - 1) * 4);
              } else {
                score -= Math.min(24, 12 + peakDayCount * 4);
              }
            }

            // 同一天的相鄰節次也儘量接同年級，避免九、七、九、七交錯。
            if (period >= 1 && period <= 7) {
              [period - 1, period + 1].filter(adjacentPeriod => adjacentPeriod >= 1 && adjacentPeriod <= 7).forEach(adjacentPeriod => {
                const adjacentGrades = teacherStats?.gradeSlots.get(day + '|' + adjacentPeriod) || new Set();
                if (adjacentGrades.size === 0) return;
                if (adjacentGrades.has(candidateGrade)) score += 12;
                else score -= 10;
              });
            }
          }
        }
      }
    }

    // 最多連日限制（超過者重罰）
    const maxDays = lesson.maxConsecDays;
    if (maxDays > 0 && maxDays < 5) {
      const allDays = [...existingDays, day].sort((a, b) => a - b);
      let streak = 1;
      for (let i = 1; i < allDays.length; i++) {
        if (allDays[i] === allDays[i - 1] + 1) streak++;
        else streak = 1;
        if (streak > maxDays) { score -= 80; break; }
      }
    }

    // 教師品質採增量評分：降低每日負擔落差，並優先填補既有空堂。
    if (teacherCodes.length > 0) {
      for (const tcCode of teacherCodes) {
      const teacherStats = lookup.teacherStats.get(canonicalAutoTeacherCode(tcCode));
      const teacherEntriesCount = teacherStats?.entryCount || 0;
      const dailyCounts = teacherStats?.dailyCounts || [0, 0, 0, 0, 0];
      const assignedValue = resolveAutoTeacherCodes(tcCode).map(code => idx.assignedWeeklyByTeacher?.[code]).find(value => Number.isFinite(value));
      const assignedTotal = Number.isFinite(assignedValue) ? assignedValue : (teacherEntriesCount + 1);
      const targetDaily = assignedTotal / 5;
      const beforeBalanceCost = dailyCounts.reduce((sum, count) => sum + Math.abs(count - targetDaily), 0);
      const afterCounts = [...dailyCounts];
      afterCounts[day - 1]++;
      const afterBalanceCost = afterCounts.reduce((sum, count) => sum + Math.abs(count - targetDaily), 0);
      const balanceDelta = beforeBalanceCost - afterBalanceCost;
      score += Math.round(balanceDelta * 14);
      const beforePeak = Math.max(...dailyCounts, 0);
      const afterPeak = Math.max(...afterCounts, 0);
      score += (beforePeak - afterPeak) * 10;
      const projectedDailyExcess = Math.max(0, afterCounts[day - 1] - Math.ceil(targetDaily) - 1);
      if (projectedDailyExcess > 0) score -= projectedDailyExcess * 8;

      const dayPeriods = teacherStats?.dayPeriods.get(day) || new Set();
      // 教師每日課表軟規則：排一不排七、排四不排五，只扣分，不阻擋合法候選。
      if ((period === 7 && dayPeriods.has(1)) || (period === 1 && dayPeriods.has(7))) score -= 6;
      if ((period === 5 && dayPeriods.has(4)) || (period === 4 && dayPeriods.has(5))) score -= 6;
      const countTeacherGaps = periods => {
        if (periods.size < 2) return 0;
        const occupied = periods, sortedPeriods = [...periods], first = Math.min(...sortedPeriods), last = Math.max(...sortedPeriods);
        let gaps = 0;
        for (let p = first + 1; p < last; p++) if (!occupied.has(p) && !idx.blockSet.has(tcCode + '|' + day + '|' + p)) gaps++;
        return gaps;
      };
      const projectedDayPeriods = new Set(dayPeriods);
      projectedDayPeriods.add(period);
      const gapDelta = countTeacherGaps(dayPeriods) - countTeacherGaps(projectedDayPeriods);
      // 加強空堂獎懲：填補空堂獎勵更強，製造空堂懲罰更強
      score += gapDelta * 22;
      const adjacentLessons = Number(dayPeriods.has(period - 1)) + Number(dayPeriods.has(period + 1));
      // 加強「孤立課程」懲罰：該天已有課但新課與任何課都不相鄰
      if (dayPeriods.size > 0 && adjacentLessons === 0) score -= 16;

      const projectedPeriods = projectedDayPeriods;
      let projectedStreak = 1;
      for (let p = period - 1; projectedPeriods.has(p); p--) projectedStreak++;
      for (let p = period + 1; projectedPeriods.has(p); p++) projectedStreak++;
      if (projectedStreak === 2) score += 2;
      else if (projectedStreak === 3) score -= 28;
      else if (projectedStreak >= 4) score -= 60;

      if (period >= 1 && period <= 7) {
        const samePeriodDays = teacherStats?.periodDays.get(period)?.size || 0;
        // 加強固定節次集中懲罰
        const repeatedPeriodPenalty = [0, 2, 7, 28, 60];
        score -= repeatedPeriodPenalty[Math.min(samePeriodDays, repeatedPeriodPenalty.length - 1)];
      }

      const projectedDailyCount = afterCounts[day - 1];
      const comfortableDailyMax = Math.max(2, Math.ceil(targetDaily));
      if (projectedDailyCount > comfortableDailyMax) score -= Math.pow(projectedDailyCount - comfortableDailyMax, 2) * 12;

      if (period >= 5 && period <= 7 && teacherEntriesCount >= 4) {
        const afternoonCount = (teacherStats?.afternoonCount || 0) + 1;
        const projectedShare = afternoonCount / (teacherEntriesCount + 1);
        if (projectedShare > 0.65) score -= Math.round((projectedShare - 0.65) * 50);
      }
    }
    }
    // 班級空格數量（空格多的班級優先排入，避免集中）
    const classEmptyCount = 5 * (autoEndPeriod - autoStartPeriod + 1) - (lookup.classActiveEntryCounts.get(String(lesson.classCode)) || 0);
    if (classEmptyCount > 15) score += 10;
    else if (classEmptyCount < 5) score -= 10;

    return score;
  }

  function evaluateSlotScoreOnSchedule(lesson, day, period, baseSchedule, includeRandom = false, baseLookup = null) {
    const previousSchedule = localSchedule;
    localSchedule = baseSchedule;
    try {
      return evaluateSlotScore(lesson, day, period, includeRandom, baseLookup || buildScheduleLookup(baseSchedule));
    } finally {
      localSchedule = previousSchedule;
    }
  }
  // 2.5 綁班群組優先排課（同科目多班必須同時段）
  const scheduledFlag = new Array(pendingLessons.length).fill(false);
  const lessonGroupBySub = {};
  pendingLessons.forEach((l, i) => {
    const key = l.subjectCode;
    if (!lessonGroupBySub[key]) lessonGroupBySub[key] = [];
    lessonGroupBySub[key].push(i);
  });

  // 第一梯隊：先排非綁班必排；綁班必排保留給下一階段的群組同步。
  function scheduleMandatoryLessons() {
  state.subjectRules.filter(isMandatoryAutoRule).forEach(rule => {
    if (shouldStopAutoSchedule('mandatory')) return;
    const allowedSlots = getRuleDaysPeriods(rule); // 整條規則定義的「合法範圍」
    getRuleSubjectCodes(rule).forEach(sub => {
    if (shouldStopAutoSchedule('mandatory')) return;

    // 對所有尚未排入的同科目課程，各自在「合法範圍」內找最佳格位排一節
    const pool = (lessonGroupBySub[sub] || []).filter(i => !scheduledFlag[i]);
    pool.forEach(i => {
      if (shouldStopAutoSchedule('mandatory')) return;
      const l = pendingLessons[i];
      const cls = idx.classByCode[l.classCode];
      const g = cls ? String(cls['年級'] || '').trim() : '';
      if (!ruleAppliesToClass(rule, l.classCode, g)) return;

      // 🔑 綁班科目跳過：由綁班群組排課統一處理（該排程本身已尊重必排規則）
      if (getBindGroupClasses(l.subjectCode, l.classCode)) return;

      // 收集此課在合法範圍內所有可排的格位（不論哪天哪節，只要在 allowedSlots 內都算候選）
      const mandatoryLookup = buildScheduleLookup(localSchedule);
      const candidates = [];

      for (const { day: dayR, period: perR } of allowedSlots) {
        if (shouldStopAutoSchedule('mandatory')) break;
        const tcCode = l.teacherCode;

        // 硬限制：教師不排課
        if (tcCode && resolveAutoTeacherCodes(tcCode).some(identity => idx.blockSet.has(identity + '|' + dayR + '|' + perR))) continue;

        // 同班同科每日一節原則
        if (!canPlaceClassSubjectOnDay(l.classCode, l.subjectCode, dayR, localSchedule, mandatoryLookup)) continue;

        // 檢查目標格是否有不可移動的凍結課
        const existingSlotIdx = localSchedule.findIndex(s =>
          String(s['班級代碼']) === String(l.classCode) &&
          parseInt(s['星期'], 10) === dayR &&
          parseInt(s['節次'], 10) === perR
        );
        let displacedEntry = null;
        if (existingSlotIdx >= 0) {
          const existing = localSchedule[existingSlotIdx];
          if (isFrozenAutoEntry(existing) || isBindAutoEntry(existing)) continue; // 凍結課與綁班不可拆開
          displacedEntry = existing;
          removeLocalScheduleAt(existingSlotIdx); // 暫時移除，驗證後還原
        }

        // 完整硬限制驗證
        const postEvictionLookup = buildScheduleLookup(localSchedule);
        const valid = isSlotValid(l.classCode, l.subjectCode, autoTeacherInput(l), dayR, perR, localSchedule, postEvictionLookup);

        // 還原暫時移除的課
        if (displacedEntry) insertLocalScheduleAt(existingSlotIdx, displacedEntry);

        if (valid) {
           candidates.push({ dayR, perR, displacedEntry, existingSlotIdx, score: evaluateSlotScore(l, dayR, perR, true, buildScheduleLookup(localSchedule)), tieBreak: autoRandomTieBreak() });
        }
      }

      if (candidates.length === 0) {
        console.warn(`  ⚠️ 必排科目 ${sub} (${l.classCode}) 在合法範圍內找不到可排格位`);
        return;
      }

      // 選最高分格位排入
      const best = selectAutoCandidate(candidates, l);

      // 正式移除讓位課程（若有）
      if (best.displacedEntry) {
        const idx2 = localSchedule.indexOf(best.displacedEntry);
        if (idx2 >= 0) removeLocalScheduleAt(idx2);
        requeuedLessons.push(makeAutoLessonFromScheduleEntry(best.displacedEntry, 'mandatory_requeue'));
      }

      // 排入
      const id = 'AUTO_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
      appendLocalSchedule({
        '課表ID': id,
        '班級代碼': String(l.classCode),
        '星期': best.dayR,
        '節次': best.perR,
        '科目代碼': String(l.subjectCode),
        '教師姓名': autoTeacherValue(l),
        '課堂屬性': getAutoScheduleAttribute(l, best.dayR, best.perR, localSchedule, buildScheduleLookup(localSchedule)),
        '是否鎖定': 'FALSE',
        '__isMustRule': true
      });
      successCount++;
      scheduledFlag[i] = true;
      console.log(`  ✅ 必排 ${sub} (${l.classCode}) → 星期${best.dayR}第${best.perR}節（從 ${allowedSlots.length} 個合法格中選最佳）`);
    });
    });
  });
  }

  await yieldToUI();
  updateProgress('第一階段：必排科目配課中…');
  markAutoScheduleProfile('mandatory');
  scheduleMandatoryLessons();
  function getRepeatedTeacherCodes(lessons) {
    const seen = new Set();
    const repeated = new Set();
    lessons.forEach(lesson => {
      getAutoTeacherCodes(autoTeacherInput(lesson)).forEach(code => {
        const canonical = canonicalAutoTeacherCode(code);
        if (!canonical) return;
        if (seen.has(canonical)) repeated.add(canonical);
        else seen.add(canonical);
      });
    });
    return [...repeated];
  }

     // 綁課讓位只處理普通課，鎖課、必排與既有綁課均不可搬動。
  function collectBindEvictions(roundLsn, day, per) {
    if (shouldStopAutoSchedule('bind-eviction')) return null;
    const targetClasses = new Set(roundLsn.map(lesson => String(lesson.classCode)));
    const teacherIdentities = new Set();
    roundLsn.forEach(lesson => {
      getAutoTeacherCodes(autoTeacherInput(lesson)).forEach(token => {
        resolveAutoTeacherCodes(token).forEach(identity => teacherIdentities.add(identity));
      });
    });
    const exclusivePeers = new Set();
    teacherIdentities.forEach(identity => {
      (autoTeacherExclusivePeers.get(identity) || []).forEach(peer => exclusivePeers.add(peer));
    });
    if ([...teacherIdentities].some(identity => idx.blockSet.has(identity + '|' + day + '|' + per))) return null;

    const victims = new Set();
    let blocked = false;
    let changed = true;
    let guard = 0;
    const addVictim = entry => {
      if (!entry || victims.has(entry)) return;
      if (isFrozenAutoEntry(entry) || isBindAutoEntry(entry)) {
        blocked = true;
        return;
      }
      victims.add(entry);
      changed = true;
    };

    while (changed && !blocked && guard < 20) {
      if (shouldStopAutoSchedule('bind-eviction')) return null;
      changed = false;
      guard++;
      const current = localSchedule.filter(entry => !victims.has(entry));
      const currentLookup = buildScheduleLookup(current);
      const currentSlotEntries = currentLookup.entriesBySlot.get(day + '|' + per) || [];
      currentSlotEntries.forEach(entry => {
        if (targetClasses.has(String(entry['班級代碼']))) {
          addVictim(entry);
          return;
        }
        const entryTeachers = resolveAutoTeacherCodes(entry);
        if (entryTeachers.some(identity => teacherIdentities.has(identity) || exclusivePeers.has(identity))) addVictim(entry);
      });

      const requestedRooms = new Map();
      roundLsn.forEach(lesson => {
        const roomCode = getSubjectRoomCode(lesson.subjectCode);
        if (!roomCode) return;
        const request = requestedRooms.get(roomCode) || { count: 0, subjectCode: lesson.subjectCode };
        request.count++;
        requestedRooms.set(roomCode, request);
      });
      requestedRooms.forEach((request, roomCode) => {
        const capacity = getSubjectRoomCapacity(request.subjectCode);
        if (request.count > capacity) {
          blocked = true;
          return;
        }
         const roomEntries = currentSlotEntries.filter(entry =>
           !isPatrolScheduleEntry(entry) &&
           getSubjectRoomCode(entry['科目代碼']) === roomCode
         );
        const need = roomEntries.length + request.count - capacity;
        if (need > 0) roomEntries.slice(0, need).forEach(addVictim);
      });

      const requestedSubjects = new Map();
      roundLsn.forEach(lesson => {
        const subject = idx.subjectByCode[String(lesson.subjectCode)];
        const maxClasses = subject ? parseInt(subject['同時最多班數'] || '0', 10) : 0;
        if (maxClasses <= 0) return;
        const subjectCode = String(lesson.subjectCode);
        const request = requestedSubjects.get(subjectCode) || { count: 0, maxClasses };
        request.count++;
        requestedSubjects.set(subjectCode, request);
      });
      requestedSubjects.forEach((request, subjectCode) => {
        if (request.count > request.maxClasses) {
          blocked = true;
          return;
        }
         const subjectEntries = currentSlotEntries.filter(entry => String(entry['科目代碼']) === subjectCode);
        const need = subjectEntries.length + request.count - request.maxClasses;
        if (need > 0) subjectEntries.slice(0, need).forEach(addVictim);
      });

      // 綁班候選格除了看「目標格」本身，也要處理會讓整組無法落位的周邊軟硬條件：
      // 同班同科同日、科目最多連日，以及教師最大連堂。只讓普通課程讓位，
      // 鎖課、必排與既有綁班仍由 addVictim() 擋住。
       roundLsn.forEach(lesson => {
        if (!canPlaceClassSubjectOnDay(
          lesson.classCode,
          lesson.subjectCode,
          day,
          current,
          currentLookup
        )) {
          current
            .filter(entry =>
              String(entry['班級代碼']) === String(lesson.classCode) &&
              String(entry['科目代碼']) === String(lesson.subjectCode) &&
              parseInt(entry['星期'], 10) === day
            )
            .slice(0, 1)
            .forEach(addVictim);
        }

        if (!canPlaceSubjectWithinMaxConsecutiveDays(
          lesson.classCode,
          lesson.subjectCode,
          day,
          current,
          currentLookup
        )) {
          current
            .filter(entry =>
              String(entry['班級代碼']) === String(lesson.classCode) &&
              String(entry['科目代碼']) === String(lesson.subjectCode)
            )
            .sort((left, right) =>
              Math.abs(parseInt(right['星期'], 10) - day) - Math.abs(parseInt(left['星期'], 10) - day)
            )
            .slice(0, 1)
            .forEach(addVictim);
        }

        getAutoTeacherCodes(autoTeacherInput(lesson)).forEach(teacherToken => {
          const teacherKey = canonicalAutoTeacherCode(teacherToken);
          const teacher = idx.teacherByCode[teacherKey];
          const maxConsec = teacher ? parseInt(teacher['最大連堂節數'] || '2', 10) : 2;
          if (countConsecutiveInLocal(current, teacherToken, day, per, currentLookup) <= maxConsec) return;
          current
            .filter(entry =>
              parseInt(entry['星期'], 10) === day &&
              autoTeacherMatches(entry, teacherToken)
            )
            .sort((left, right) =>
              Math.abs(parseInt(right['節次'], 10) - per) - Math.abs(parseInt(left['節次'], 10) - per)
            )
            .slice(0, 1)
            .forEach(addVictim);
        });
      });
    }

    if (blocked || guard >= 20) return null;
    const remaining = localSchedule.filter(entry => !victims.has(entry));
    const lookup = buildScheduleLookup(remaining);
    return roundLsn.every(lesson =>
      isSlotValid(lesson.classCode, lesson.subjectCode, autoTeacherInput(lesson), day, per, remaining, lookup)
    ) ? [...victims] : null;
  }

  const BIND_GROUP_SLOT_YIELD_INTERVAL = 12;
  const BIND_GROUP_SEARCH_YIELD_INTERVAL = 24;
  const BIND_GROUP_SEARCH_TIME_BUDGET_MS = 60000;
  async function findAndScheduleBlockGroup(group, groupIndex, totalGroups, bindAttempt = 0) {
    if (shouldStopAutoSchedule('bind')) return false;
    const subList = typeof group['科目清單'] === 'string'
      ? group['科目清單'].split(',').map(value => value.trim()).filter(Boolean)
      : (typeof group['科目代碼'] === 'string' ? group['科目代碼'].split(',').map(value => value.trim()).filter(Boolean) : []);
    const clsList = typeof group['班級清單'] === 'string'
      ? group['班級清單'].split(',').map(value => value.trim()).filter(Boolean)
      : (Array.isArray(group['班級清單']) ? group['班級清單'] : (typeof group['班級清單'] === 'number' ? String(group['班級清單']).match(/.{3}/g) || [] : []));
    if (clsList.length < 2) return true;
    if (invalidBindGroups.has(group.__bindParentGroup || group)) {
      console.warn('綁班每週節數不一致，整組略過：' + clsList.join('、'));
      return false;
    }
    // 綁班群組必須原子完成：若其中一個科目／輪次失敗，回復整個群組，
    // 不讓半套綁班佔住時段，影響下一輪群組搜尋。
    const groupScheduleSnapshot = [...localSchedule];
    const groupRequeueSnapshot = [...requeuedLessons];
    const groupFlagSnapshot = [...scheduledFlag];
    const groupSuccessSnapshot = successCount;
    const restoreGroupSnapshot = () => {
      replaceLocalSchedule(groupScheduleSnapshot);
      requeuedLessons.length = 0;
      requeuedLessons.push(...groupRequeueSnapshot);
      for (let index = 0; index < scheduledFlag.length; index++) scheduledFlag[index] = groupFlagSnapshot[index];
      successCount = groupSuccessSnapshot;
    };
    let groupSolved = true;
    let bindRoundDiagnostics = [];
    updateProgress('綁班群組配課中（' + totalGroups + ' 群組，目前第 ' + (groupIndex + 1) + ' 組）…');
    await yieldToUI();

    const members = getAutoBindMembers(group);
    const memberKeys = new Set(members.map(member => getAutoBindMemberKey(member.classCode, member.subjectCode)));
    const subjectOrder = new Map(subList.map((subjectCode, index) => [subjectCode, index]));
    const byClass = {};
    pendingLessons.forEach((lesson, index) => {
      if (scheduledFlag[index] || !memberKeys.has(getAutoBindMemberKey(lesson.classCode, lesson.subjectCode))) return;
      if (!byClass[lesson.classCode]) byClass[lesson.classCode] = [];
      byClass[lesson.classCode].push({ index, lesson });
    });
    const classCodes = [...new Set(members.map(member => member.classCode))];
    classCodes.forEach(classCode => {
      (byClass[classCode] || []).sort((left, right) =>
        (subjectOrder.get(left.lesson.subjectCode) ?? Number.MAX_SAFE_INTEGER) -
        (subjectOrder.get(right.lesson.subjectCode) ?? Number.MAX_SAFE_INTEGER) ||
        left.index - right.index
      );
    });
    const rounds = Math.max(0, ...classCodes.map(classCode => byClass[classCode]?.length || 0));
    if (classCodes.length < 2 || rounds === 0) return true;
    console.log('  綁班「' + (group['群組名稱'] || group['群組ID']) + '」：' + classCodes.length + ' 班，最多 ' + rounds + ' 節');

    const bindRoundData = [];
    let bindDefinitionValid = true;
    for (let round = 0; round < rounds; round++) {
      const roundItems = classCodes.map(classCode => byClass[classCode]?.[round]).filter(Boolean);
      if (roundItems.length !== classCodes.length) {
        console.warn('綁班各班待排節數不一致，無法拆班個別排入：' + classCodes.join('、'));
        bindDefinitionValid = false;
        break;
      }
      const roundIndexes = roundItems.map(item => item.index);
      const roundLsn = roundItems.map(item => item.lesson);
      const repeatedTeachers = getRepeatedTeacherCodes(roundLsn);
      if (repeatedTeachers.length > 0) {
        console.warn('綁班組內教師衝堂，整組停止：' + repeatedTeachers.join('、'));
        bindDefinitionValid = false;
        break;
      }
      bindRoundData.push({ round, roundIndexes, roundLsn });
    }
    if (!bindDefinitionValid || bindRoundData.length !== rounds) {
      groupSolved = false;
    } else {
      const initialLookup = buildScheduleLookup(localSchedule);
      const directCandidateCounts = new Map();
      const countDirectCandidates = roundData => {
        let count = 0;
        for (let day = 1; day <= 5; day++) {
          for (let per = autoStartPeriod; per <= autoEndPeriod; per++) {
            if (roundData.roundLsn.every(lesson => isSlotValid(
              lesson.classCode,
              lesson.subjectCode,
              autoTeacherInput(lesson),
              day,
              per,
              localSchedule,
              initialLookup
            ))) count++;
          }
        }
        directCandidateCounts.set(roundData.round, count);
        return count;
      };
      bindRoundData.sort((left, right) => countDirectCandidates(left) - countDirectCandidates(right) || left.round - right.round);
      bindRoundDiagnostics = bindRoundData.map(roundData => ({
        round: roundData.round + 1,
        directCommonSlots: directCandidateCounts.get(roundData.round) || 0
      }));
      const BIND_GROUP_BACKTRACK_NODE_LIMIT = 20000;
      const BIND_GROUP_BRANCH_LIMIT = 35;
      let bindSearchNodes = 0;
      let bindSearchTimedOut = false;
      const bindSearchStartedAt = Date.now();
      const bindSearchTimeBudgetMs = Math.min(
        BIND_GROUP_SEARCH_TIME_BUDGET_MS,
        Math.max(
          5000,
          Math.floor((autoScheduleDeadline - bindSearchStartedAt) / Math.max(1, Math.min(6, totalGroups - groupIndex)))
        )
      );
      const shouldStopBindSearch = () => {
        if (shouldStopAutoSchedule('bind-search') || Date.now() - bindSearchStartedAt >= bindSearchTimeBudgetMs) {
          bindSearchTimedOut = true;
          return true;
        }
        return false;
      };

      async function searchBindRounds(roundPosition) {
        if (roundPosition >= bindRoundData.length) return true;
        if (bindSearchNodes >= BIND_GROUP_BACKTRACK_NODE_LIMIT || shouldStopBindSearch()) return false;

        const { round, roundIndexes, roundLsn } = bindRoundData[roundPosition];
        if (bindSearchNodes % BIND_GROUP_SEARCH_YIELD_INTERVAL === 0) {
          updateProgress(`第 ${round + 1} 輪綁班群組補配中（第 ${groupIndex + 1} 組，搜尋 ${bindSearchNodes + 1}）…`);
          await yieldToUI();
        }

        const candidatesBySlot = new Map();
        const lookup = buildScheduleLookup(localSchedule);
        let slotChecks = 0;
        for (let day = 1; day <= 5; day++) {
          for (let per = autoStartPeriod; per <= autoEndPeriod; per++) {
            if (shouldStopBindSearch()) return false;
            if (++slotChecks % BIND_GROUP_SLOT_YIELD_INTERVAL === 0) await yieldToUI();
            if (!roundLsn.every(lesson => isSlotValid(lesson.classCode, lesson.subjectCode, autoTeacherInput(lesson), day, per, localSchedule, lookup))) continue;
            const score = roundLsn.reduce((sum, lesson) => sum + evaluateSlotScore(lesson, day, per, true, lookup), 0);
            candidatesBySlot.set(day + '|' + per, { day, per, score, tieBreak: autoRandomTieBreak(), toEvict: [] });
          }
        }

        for (let day = 1; day <= 5; day++) {
          for (let per = autoStartPeriod; per <= autoEndPeriod; per++) {
            if (shouldStopBindSearch()) return false;
            const slotKey = day + '|' + per;
            if (candidatesBySlot.has(slotKey)) continue;
            const toEvict = collectBindEvictions(roundLsn, day, per);
            if (!toEvict || toEvict.length === 0) continue;
            const score = roundLsn.reduce((sum, lesson) => sum + evaluateSlotScore(lesson, day, per, true, buildScheduleLookup(localSchedule)), 0) - toEvict.length * 4;
            candidatesBySlot.set(slotKey, { day, per, score, tieBreak: autoRandomTieBreak(), toEvict });
          }
        }

        const candidateValues = [...candidatesBySlot.values()];
        const prioritizedCandidates = prioritizeAutoCandidates(
          candidateValues,
          roundLsn,
          candidate => {
            const candidateSchedule = candidate.toEvict?.length
              ? localSchedule.filter(entry => !candidate.toEvict.includes(entry))
              : localSchedule;
            return {
              schedule: candidateSchedule,
              lookup: buildScheduleLookup(candidateSchedule)
            };
          },
          (left, right) => (left.toEvict?.length || 0) - (right.toEvict?.length || 0) || compareAutoCandidates(left, right)
        );
        // 同一批群組重試時，不要每次都走同一條候選路徑；旋轉完整候選集合，
        // 讓共享教師的群組有機會取得不同的合法時段組合，仍不放寬任何硬限制。
        const rotation = prioritizedCandidates.length > 1 && bindAttempt > 0
          ? (bindAttempt * 11 + groupIndex * 3 + roundPosition * 7) % prioritizedCandidates.length
          : 0;
        const rotatedCandidates = rotation > 0
          ? prioritizedCandidates.slice(rotation).concat(prioritizedCandidates.slice(0, rotation))
          : prioritizedCandidates;
        const candidates = rotatedCandidates.slice(0, BIND_GROUP_BRANCH_LIMIT);
        for (const candidate of candidates) {
          if (++bindSearchNodes > BIND_GROUP_BACKTRACK_NODE_LIMIT || shouldStopBindSearch()) break;
          const scheduleSnapshot = [...localSchedule];
          const requeueSnapshot = [...requeuedLessons];
          const flagSnapshot = [...scheduledFlag];
          const successSnapshot = successCount;

          candidate.toEvict.forEach(entry => {
            const entryIndex = localSchedule.indexOf(entry);
            if (entryIndex >= 0) removeLocalScheduleAt(entryIndex);
            requeuedLessons.push(makeAutoLessonFromScheduleEntry(entry, 'bind_evict'));
          });
          roundLsn.forEach((lesson, lessonIndex) => {
            appendLocalSchedule({
              '課表ID': 'AUTO_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4) + '_B' + round + '_' + lessonIndex,
              '班級代碼': String(lesson.classCode),
              '星期': candidate.day,
              '節次': candidate.per,
              '科目代碼': String(lesson.subjectCode),
              '教師姓名': autoTeacherValue(lesson),
               '課堂屬性': getAutoScheduleAttribute(lesson, candidate.day, candidate.per, localSchedule, buildScheduleLookup(localSchedule)),
               '是否鎖定': 'FALSE',
               '__isBindGroup': true,
              '__bindGroupKey': String(group['群組ID'] || group['群組名稱'] || groupIndex) + '|' + round
            });
            successCount++;
            scheduledFlag[roundIndexes[lessonIndex]] = true;
          });

          if (await searchBindRounds(roundPosition + 1)) return true;

          replaceLocalSchedule(scheduleSnapshot);
          requeuedLessons.length = 0;
          requeuedLessons.push(...requeueSnapshot);
          for (let index = 0; index < scheduledFlag.length; index++) scheduledFlag[index] = flagSnapshot[index];
          successCount = successSnapshot;
        }
        return false;
      }

      const bindSolved = await searchBindRounds(0);
      if (!bindSolved) {
        groupSolved = false;
        console.warn((bindSearchTimedOut ? '綁班搜尋逾時，保留未排：' : '綁班整組回溯後仍無共同可用時段：') + classCodes.join('、') + '，搜尋 ' + bindSearchNodes + ' 個節點');
        bindFailureDiagnostics.set(
          String(group['群組ID'] || group['群組名稱'] || groupIndex) + '|' + classCodes.join(','),
          {
            groupId: String(group['群組ID'] || group['群組名稱'] || groupIndex),
            groupName: String(group['群組名稱'] || ''),
            classCodes,
            rounds,
            roundDiagnostics: bindRoundDiagnostics,
            searchNodes: bindSearchNodes,
            searchTimedOut: bindSearchTimedOut,
            searchBudgetMs: bindSearchTimeBudgetMs
          }
        );
      } else {
        const diagnosticKey = String(group['群組ID'] || group['群組名稱'] || groupIndex) + '|' + classCodes.join(',');
        bindFailureDiagnostics.delete(diagnosticKey);
        console.log('    綁班整組完成：' + classCodes.join('、') + '，共 ' + rounds + ' 輪，搜尋 ' + bindSearchNodes + ' 個節點');
      }
    }
    if (!groupSolved) restoreGroupSnapshot();
    return groupSolved;
  }

  await yieldToUI();
  const bindCandidateGroups = state.blockGroups.flatMap(expandAutoBindGroupCohorts);
  updateProgress('第二階段：綁班群組配對中（' + bindCandidateGroups.length + ' 組）…');
  markAutoScheduleProfile('bind');
  const bindPassScheduleSnapshot = [...localSchedule];
  const bindPassRequeueSnapshot = [...requeuedLessons];
  const bindPassFlagSnapshot = [...scheduledFlag];
  const bindPassSuccessSnapshot = successCount;
  const attemptedBindOrders = new Set();
  const maxBindOrderAttempts = Math.max(6, Math.min(10, bindCandidateGroups.length * 2 + 2));
  const isMandatoryBindGroup = group => {
    const groupSubjects = typeof group['科目清單'] === 'string'
      ? group['科目清單'].split(',').map(value => value.trim()).filter(Boolean)
      : (typeof group['科目代碼'] === 'string' ? group['科目代碼'].split(',').map(value => value.trim()).filter(Boolean) : []);
    const groupClasses = typeof group['班級清單'] === 'string'
      ? group['班級清單'].split(',').map(value => value.trim()).filter(Boolean)
      : (Array.isArray(group['班級清單']) ? group['班級清單'].map(value => String(value).trim()) : []);
    return pendingLessons.some((lesson, index) =>
      !scheduledFlag[index] &&
      lesson.hasMustRule &&
      groupClasses.includes(String(lesson.classCode)) &&
      groupSubjects.some(subjectCode => String(lesson.subjectCode) === String(subjectCode))
    );
  };
  const estimateBindGroupSlots = group => {
    const members = getAutoBindMembers(group);
    const classCodes = [...new Set(members.map(member => member.classCode))];
    if (members.length === 0 || classCodes.length < 2) return Number.MAX_SAFE_INTEGER;
    if (invalidBindGroups.has(group.__bindParentGroup || group)) return 0;
    const lookup = buildScheduleLookup(localSchedule);
    const memberKeys = new Set(members.map(member => getAutoBindMemberKey(member.classCode, member.subjectCode)));
    const subjectOrder = new Map(getAutoBindSubjects(group).map((subjectCode, index) => [subjectCode, index]));
    const byClass = {};
    pendingLessons.forEach((lesson, index) => {
      if (scheduledFlag[index] || !memberKeys.has(getAutoBindMemberKey(lesson.classCode, lesson.subjectCode))) return;
      if (!byClass[lesson.classCode]) byClass[lesson.classCode] = [];
      byClass[lesson.classCode].push({ index, lesson });
    });
    classCodes.forEach(classCode => {
      (byClass[classCode] || []).sort((left, right) =>
        (subjectOrder.get(left.lesson.subjectCode) ?? Number.MAX_SAFE_INTEGER) -
        (subjectOrder.get(right.lesson.subjectCode) ?? Number.MAX_SAFE_INTEGER) ||
        left.index - right.index
      );
    });
    const activeClassCodes = classCodes.filter(classCode => (byClass[classCode] || []).length > 0);
    if (activeClassCodes.length < 2) return Number.MAX_SAFE_INTEGER;
    const rounds = Math.max(...activeClassCodes.map(classCode => byClass[classCode].length));
    let minimumSharedSlots = Number.MAX_SAFE_INTEGER;
    for (let round = 0; round < rounds; round++) {
      const roundLessons = activeClassCodes.map(classCode => byClass[classCode][round]).filter(Boolean).map(item => item.lesson);
      if (roundLessons.length !== activeClassCodes.length) return 0;
      let sharedSlots = 0;
      for (let day = 1; day <= 5; day++) {
        for (let period = autoStartPeriod; period <= autoEndPeriod; period++) {
          if (roundLessons.every(lesson => isSlotValid(
            lesson.classCode,
            lesson.subjectCode,
            autoTeacherInput(lesson),
            day,
            period,
            localSchedule,
            lookup
          ))) sharedSlots++;
        }
      }
      minimumSharedSlots = Math.min(minimumSharedSlots, sharedSlots);
    }
    return minimumSharedSlots;
  };
  updateProgress('分析綁班群組可行格位中…');
  const getBindCohortComplexity = group => {
    const members = getAutoBindMembers(group);
    const memberKeys = new Set(members.map(member => getAutoBindMemberKey(member.classCode, member.subjectCode)));
    const counts = new Map();
    pendingLessons.forEach((lesson, index) => {
      if (scheduledFlag[index] || !memberKeys.has(getAutoBindMemberKey(lesson.classCode, lesson.subjectCode))) return;
      const classCode = String(lesson.classCode || '').trim();
      counts.set(classCode, (counts.get(classCode) || 0) + 1);
    });
    const classCount = new Set(members.map(member => member.classCode)).size;
    const rounds = Math.max(0, ...counts.values());
    return { rounds, classCount, work: rounds * classCount };
  };
  const bindComplexity = new Map(bindCandidateGroups.map(group => [group, getBindCohortComplexity(group)]));
  const bindDifficulty = new Map(bindCandidateGroups.map(group => [group, estimateBindGroupSlots(group)]));
  const bindTieBreak = new Map(bindCandidateGroups.map(group => [group, autoRandomTieBreak()]));
  let bindOrder = [...bindCandidateGroups].filter(group => !invalidBindGroups.has(group.__bindParentGroup || group)).sort((left, right) => {
    const mandatoryDelta = Number(isMandatoryBindGroup(right)) - Number(isMandatoryBindGroup(left));
    if (mandatoryDelta !== 0) return mandatoryDelta;
    const leftComplexity = bindComplexity.get(left) || { work: 0, rounds: 0, classCount: 0 };
    const rightComplexity = bindComplexity.get(right) || { work: 0, rounds: 0, classCount: 0 };
    if (leftComplexity.work !== rightComplexity.work) return rightComplexity.work - leftComplexity.work;
    if (leftComplexity.rounds !== rightComplexity.rounds) return rightComplexity.rounds - leftComplexity.rounds;
    const leftSlots = bindDifficulty.get(left) ?? Number.MAX_SAFE_INTEGER;
    const rightSlots = bindDifficulty.get(right) ?? Number.MAX_SAFE_INTEGER;
    if (leftSlots !== rightSlots) return leftSlots - rightSlots;
    const classDelta = getAutoBindClasses(right).length - getAutoBindClasses(left).length;
    if (classDelta !== 0) return classDelta;
    return (bindTieBreak.get(left) || 0.5) - (bindTieBreak.get(right) || 0.5);
  });
  let unresolvedBindGroups = [];
  for (let bindAttempt = 0; bindAttempt < maxBindOrderAttempts; bindAttempt++) {
    if (bindAttempt > 0) {
      replaceLocalSchedule(bindPassScheduleSnapshot);
      requeuedLessons.length = 0;
      requeuedLessons.push(...bindPassRequeueSnapshot);
      for (let index = 0; index < scheduledFlag.length; index++) scheduledFlag[index] = bindPassFlagSnapshot[index];
      successCount = bindPassSuccessSnapshot;
    }
    const orderSignature = bindOrder.map(group => String(group['群組ID'] || group['群組名稱'] || '')).join('|');
    attemptedBindOrders.add(orderSignature);
    unresolvedBindGroups = [];
    updateProgress('綁班群組第 ' + (bindAttempt + 1) + ' 輪整批搜尋中…');
    for (let groupIndex = 0; groupIndex < bindOrder.length; groupIndex++) {
      if (shouldStopAutoSchedule('bind-order')) {
        unresolvedBindGroups.push(...bindOrder.slice(groupIndex));
        break;
      }
      const solved = await findAndScheduleBlockGroup(bindOrder[groupIndex], groupIndex, bindOrder.length, bindAttempt);
      if (!solved) unresolvedBindGroups.push(bindOrder[groupIndex]);
    }
    if (autoScheduleTimedOut) break;
    if (unresolvedBindGroups.length === 0) break;
    const failedSet = new Set(unresolvedBindGroups);
    const remainingGroups = bindOrder.filter(group => !failedSet.has(group));
    let nextOrder = [...unresolvedBindGroups, ...remainingGroups];
    let nextSignature = nextOrder.map(group => String(group['群組ID'] || group['群組名稱'] || '')).join('|');
    if (attemptedBindOrders.has(nextSignature)) {
      nextOrder = [...unresolvedBindGroups, ...remainingGroups.reverse()];
      nextSignature = nextOrder.map(group => String(group['群組ID'] || group['群組名稱'] || '')).join('|');
    }
    if (attemptedBindOrders.has(nextSignature)) break;
    bindOrder = nextOrder;
  }
  if (unresolvedBindGroups.length > 0) {
    console.warn('綁班整批搜尋仍有 ' + unresolvedBindGroups.length + ' 組未完成。');
  }
  const unresolvedBindLessons = pendingLessons.filter((lesson, index) =>
    !scheduledFlag[index] && !!getBindGroupClasses(lesson.subjectCode, lesson.classCode)
  );
  if (unresolvedBindLessons.length > 0) {
    unresolvedBindLessons.forEach(lesson => {
      lesson.failureReason = bindWeeklyMismatchByKey.has(String(lesson.classCode) + '|' + String(lesson.subjectCode))
        ? 'bind-group-weekly-mismatch'
        : 'bind-group-no-common-slot';
      bindFailureLessons.push(lesson);
    });
    console.warn('綁班前置關卡未完成，一般課程不會代替綁班個別排入：' + unresolvedBindLessons.length + ' 節');
  }
  // 第一階段必排已完成，現在才進入綁班後的一般課程佇列。
  // 開始進行排課（已排入的綁班群組課程自動跳過）
  await yieldToUI();
  updateProgress(`排入一般課程 (${autoStartPeriod}~${autoEndPeriod} 節)…`);
  // 綁班課程已在前置階段整組處理；無論成功或失敗，都不進入一般課程佇列個別排入。
  const lessonQueue = pendingLessons.map((_, index) => index).filter(index =>
    !scheduledFlag[index] && !getBindGroupClasses(pendingLessons[index].subjectCode, pendingLessons[index].classCode)
  );
  markAutoScheduleProfile('general');
  const generalValidSlotCache = new WeakMap();
  function getGeneralValidSlots(lesson, scheduleLookup) {
    const cached = generalValidSlotCache.get(lesson);
    if (cached?.version === localScheduleMutationVersion) return cached.slots;
    const slots = [];
    let complete = true;
    slotSearch: for (let day = 1; day <= 5; day++) {
      for (let period = autoStartPeriod; period <= autoEndPeriod; period++) {
        if (shouldStopAutoSchedule('general-availability')) {
          complete = false;
          break slotSearch;
        }
        if (isSlotValid(lesson.classCode, lesson.subjectCode, autoTeacherInput(lesson), day, period, localSchedule, scheduleLookup)) {
          slots.push({ day, per: period });
        }
      }
    }
    if (complete) generalValidSlotCache.set(lesson, { version: localScheduleMutationVersion, slots });
    return slots;
  }
  function countAvailableSlots(lesson, scheduleLookup, validationOptions = {}) {
    if (getBindGroupClasses(lesson.subjectCode, lesson.classCode)) return 0;
    if (Object.keys(validationOptions).length === 0) return getGeneralValidSlots(lesson, scheduleLookup).length;
    let count = 0;
    for (let day = 1; day <= 5; day++) for (let period = autoStartPeriod; period <= autoEndPeriod; period++) {
      if (shouldStopAutoSchedule('availability-count')) return count;
      if (isSlotValid(lesson.classCode, lesson.subjectCode, autoTeacherInput(lesson), day, period, localSchedule, scheduleLookup, validationOptions)) count++;
    }
    return count;
  }
  function estimateAutoAvailableSlots(lesson, scheduleLookup) {
    if (getBindGroupClasses(lesson.subjectCode, lesson.classCode)) return 0;
    const domainSlots = Math.max(0, 5 * (autoEndPeriod - autoStartPeriod + 1));
    if (domainSlots === 0) return 0;
    let estimate = domainSlots;
    const classUsed = scheduleLookup?.classActiveEntryCounts?.get(String(lesson.classCode)) || 0;
    estimate = Math.min(estimate, Math.max(0, domainSlots - classUsed));
    if (lesson.teacherCode) estimate = Math.min(estimate, Math.max(0, Number(lesson.teacherAvailableSlots) || 0));
    const applicableRules = getApplicableRules(lesson.subjectCode, lesson.classCode);
    const mandatorySlots = applicableRules
      .filter(entry => isMandatoryAutoRule(entry.rule))
      .flatMap(entry => entry.slots)
      .filter(slot => slot.period >= autoStartPeriod && slot.period <= autoEndPeriod);
    if (mandatorySlots.length > 0) estimate = Math.min(estimate, mandatorySlots.length);
    const forbiddenSlots = applicableRules
      .filter(entry => isForbiddenAutoRule(entry.rule))
      .flatMap(entry => entry.slots)
      .filter(slot => slot.period >= autoStartPeriod && slot.period <= autoEndPeriod).length;
    estimate = Math.max(0, estimate - forbiddenSlots);
    return estimate;
  }
  function classifyNoLegalSlot(lesson, fallbackReason = 'no-legal-slot') {
    if (fallbackReason === 'no-legal-slot' && autoTightClassCodes.has(String(lesson?.classCode || ''))) {
      return 'class-zero-slack-no-legal-slot';
    }
    return fallbackReason;
  }
  function compareGeneralLessonPriority(left, right) {
    const manualPriorityDelta = (Number(right.priorityScore) || 0) - (Number(left.priorityScore) || 0);
    if (manualPriorityDelta !== 0) return manualPriorityDelta;
    // 先排真正最難安排的課，避免寬鬆課程先佔掉稀有格位。
    // dynamicDifficulty 近似 dom/wdeg：可用域越小、歷次失敗資源越集中者越優先。
    const dynamicDifficultyDelta = (Number(right.dynamicDifficulty) || 0) - (Number(left.dynamicDifficulty) || 0);
    if (dynamicDifficultyDelta !== 0) return dynamicDifficultyDelta;
    const availabilityDelta = (Number(left.availableSlots) || 0) - (Number(right.availableSlots) || 0);
    if (availabilityDelta !== 0) return availabilityDelta;
    const subjectConstraintDelta = (Number(right.subjectConstraintScore) || 0) - (Number(left.subjectConstraintScore) || 0);
    if (subjectConstraintDelta !== 0) return subjectConstraintDelta;
    const constraintDelta = (Number(right.teacherConstraintScore) || 0) - (Number(left.teacherConstraintScore) || 0);
    if (constraintDelta !== 0) return constraintDelta;
    return (Number(left.index) || 0) - (Number(right.index) || 0);
  }
  const AUTO_QUEUE_REPRIORITIZE_INTERVAL = lessonQueue.length > 256 ? 128 : 8;
  const AUTO_PRIORITY_YIELD_INTERVAL = 8;
  for (let queuePos = 0; queuePos < lessonQueue.length; queuePos++) {
    if (shouldStopAutoSchedule('general')) {
      lessonQueue.slice(queuePos).forEach(index => markAutoFailure(pendingLessons[index], 'time-budget'));
      break;
    }
    if (queuePos % AUTO_QUEUE_REPRIORITIZE_INTERVAL === 0) {
      const remainingQueue = lessonQueue.slice(queuePos);
      const priorityLookup = buildScheduleLookup(localSchedule);
      const prioritizedQueue = [];
      for (let priorityPos = 0; priorityPos < remainingQueue.length; priorityPos++) {
        if (shouldStopAutoSchedule('general-priority')) break;
        if (priorityPos % AUTO_PRIORITY_YIELD_INTERVAL === 0) {
          await yieldToUI();
          updateProgress('一般課程優先排序中（' + (queuePos + priorityPos) + '/' + lessonQueue.length + '）…');
        }
        const lessonIndex = remainingQueue[priorityPos];
        const availableSlots = estimateAutoAvailableSlots(pendingLessons[lessonIndex], priorityLookup);
        prioritizedQueue.push({
          index: lessonIndex,
          priorityScore: pendingLessons[lessonIndex].priorityScore,
          subjectConstraintScore: pendingLessons[lessonIndex].subjectConstraintScore,
          teacherConstraintScore: pendingLessons[lessonIndex].teacherConstraintScore,
          availableSlots,
          dynamicPressure: getAutoConflictPressure(pendingLessons[lessonIndex]),
          dynamicDifficulty: getAutoDynamicDifficulty(pendingLessons[lessonIndex], availableSlots)
        });
      }
      prioritizedQueue.sort(compareGeneralLessonPriority);
      const exactPriorityLimit = Math.min(64, prioritizedQueue.length);
      for (let exactIndex = 0; exactIndex < exactPriorityLimit; exactIndex++) {
        if (shouldStopAutoSchedule('general-exact-priority')) break;
        const priorityItem = prioritizedQueue[exactIndex];
        const lesson = pendingLessons[priorityItem.index];
        const availableSlots = countAvailableSlots(lesson, priorityLookup);
        priorityItem.availableSlots = availableSlots;
        priorityItem.dynamicPressure = getAutoConflictPressure(lesson);
        priorityItem.dynamicDifficulty = getAutoDynamicDifficulty(lesson, availableSlots);
      }
      prioritizedQueue.sort(compareGeneralLessonPriority);
      lessonQueue.splice(queuePos, remainingQueue.length, ...prioritizedQueue.map(item => item.index));
    }
    if (autoScheduleTimedOut) {
      lessonQueue.slice(queuePos).forEach(index => markAutoFailure(pendingLessons[index], 'time-budget'));
      break;
    }
    const li = lessonQueue[queuePos];
    if (queuePos > 0 && queuePos % 20 === 0) {
      await yieldToUI();
      updateProgress(`排入一般課程… (${successCount}/${pendingLessons.length})`);
    }
    const lesson = pendingLessons[li];

    // 綁班群組科目：若群組排課失敗，不允許個別排入
    if (getBindGroupClasses(lesson.subjectCode, lesson.classCode)) {
      console.log(`  ❌ 綁班課程被拒絕排入: ${lesson.subjectCode} (班級 ${lesson.classCode})`);
      markAutoFailure(lesson, 'bind-group-no-common-slot');
      continue;
    }

    const lessonLookup = buildScheduleLookup(localSchedule);
    const candidateSlots = getGeneralValidSlots(lesson, lessonLookup)
      .map(slot => ({ ...slot, score: evaluateSlotScore(lesson, slot.day, slot.per, true, lessonLookup), tieBreak: autoRandomTieBreak() }));

    if (candidateSlots.length > 0) {
      const best = selectAutoCandidate(candidateSlots, lesson);
      appendLocalSchedule({
        '課表ID': 'AUTO_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        '班級代碼': String(lesson.classCode),
        '星期': best.day, '節次': best.per,
        '科目代碼': String(lesson.subjectCode),
        '教師姓名': autoTeacherValue(lesson),
        '課堂屬性': getAutoScheduleAttribute(lesson, best.day, best.per, localSchedule, lessonLookup),
              '是否鎖定': 'FALSE'
      });
      successCount++;
    } else {
      // 4. 智慧交換機制：嘗試移動已排課程來騰出位置
      let swapped = false;
      if (!autoScheduleTimedOut && optSmartSwap) {
        // 必排科目：可移動任何班級的課程來騰出指定時段
        // 一般科目：只移動同班級的課程
        const trySwapAll = lesson.hasMustRule && lesson.mustRuleSlots && lesson.mustRuleSlots.length > 0;
        const movableClassSlots = new Map();
        localSchedule.forEach((entry, entryIndex) => {
          if (String(entry['班級代碼']) !== String(lesson.classCode)) return;
          const entryDay = parseInt(entry['星期'], 10);
          const entryPeriod = parseInt(entry['節次'], 10);
          if (entryDay < 1 || entryDay > 5 || entryPeriod < autoStartPeriod || entryPeriod > autoEndPeriod) return;
          if (String(entry['是否鎖定']).toUpperCase() === 'TRUE') return;
          if (isFrozenAutoEntry(entry) || isMustPlacedCourse(entry) || isBindAutoEntry(entry)) return;
          movableClassSlots.set(entryDay + '|' + entryPeriod, entryIndex);
        });

        for (let day = 1; day <= 5 && !swapped; day++) {
          for (let per = autoStartPeriod; per <= autoEndPeriod && !swapped; per++) {
            if (shouldStopAutoSchedule('general-swap')) break;
            // 必排：只在必排時段嘗試交換（精準命中）
            if (trySwapAll) {
              const isMustDayPer = lesson.mustRuleSlots.some(s => s.day === day && s.per === per);
              if (!isMustDayPer) continue;
            }

            // 必排：先找同班級是否佔用此格（清出目標班級的指定時段）
            const occupiedIdx = movableClassSlots.get(day + '|' + per);
            if (occupiedIdx >= 0) {
              const victim = localSchedule[occupiedIdx];
              const tempSched = localSchedule.filter((_, i) => i !== occupiedIdx);
              const tempLookup = buildScheduleLookup(tempSched);
              if (isSlotValid(lesson.classCode, lesson.subjectCode, autoTeacherInput(lesson), day, per, tempSched, tempLookup)) {
                // 建立「含新課（lesson 排在 day/per）」的 lookup，用於驗證 victim 的新位置
                // 避免：victim 與 lesson 同班同科時，victim 搬到 lesson 同一天卻查不到 lesson 的計數
                const tempSchedWithLesson = [...tempSched, {
                  '班級代碼': String(lesson.classCode),
                  '星期': day, '節次': per,
                  '科目代碼': String(lesson.subjectCode),
                  '教師姓名': autoTeacherValue(lesson)
                }];
                const tempLookupWithLesson = buildScheduleLookup(tempSchedWithLesson);
                // 對所有合法的 victim 新位置評分，選最佳（而非第一個合法）
                let victimCandidate = null;
                for (let newD = 1; newD <= 5; newD++) {
                  for (let newP = autoStartPeriod; newP <= autoEndPeriod; newP++) {
                    if (newD === day && newP === per) continue;
                    // 用含新課的 lookup 驗證 victim 新位置，防止同班同科同日重複
                    if (isSlotValid(victim['班級代碼'], victim['科目代碼'], victim['教師姓名'], newD, newP, tempSchedWithLesson, tempLookupWithLesson)) {
                      victimCandidate = { newD, newP };
                      break;
                    }
                  }
                  if (victimCandidate) break;
                }
                if (victimCandidate && !swapped) {
                  // 選第一個合法位置（swap 不做評分，效能優先）
                  const { newD, newP } = victimCandidate;
                  setLocalScheduleEntry(occupiedIdx, { ...victim, '星期': newD, '節次': newP });
                  appendLocalSchedule({
                    '課表ID': 'AUTO_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                    '班級代碼': String(lesson.classCode),
                    '星期': day, '節次': per,
                    '科目代碼': String(lesson.subjectCode),
                    '教師姓名': autoTeacherValue(lesson),
                    '課堂屬性': getAutoScheduleAttribute(lesson, day, per, localSchedule, buildScheduleLookup(localSchedule)),
                    '是否鎖定': 'FALSE'
                  });
                  successCount++;
                  swapped = true;
                }
              }
            }
          }
        }
      }

      if (!swapped) {
        markAutoFailure(lesson, classifyNoLegalSlot(lesson));
      }
    }
  }

  if (requeuedLessons.length > 0) failList = failList.concat(requeuedLessons);

  // 多輪重跑：失敗的課程在下一輪重新嘗試（最多3輪）
  markAutoScheduleProfile('retry');
  for (let round = 2; round <= 3 && failList.length > 0; round++) {
    if (shouldStopAutoSchedule('retry')) break;
    await yieldToUI();
    updateProgress(`第 ${round} 輪重跑 (${failList.length} 節待排)…`);
    let retryList = [...failList];
    failList = [];

    // 重新排序
    retryList.sort((a, b) => {
      if (a.hasMustRule && !b.hasMustRule) return -1;
      if (!a.hasMustRule && b.hasMustRule) return 1;
      if ((a.priorityScore || 0) !== (b.priorityScore || 0)) {
        return (b.priorityScore || 0) - (a.priorityScore || 0);
      }
      const dynamicPressureDelta = getAutoConflictPressure(b) - getAutoConflictPressure(a);
      if (dynamicPressureDelta !== 0) return dynamicPressureDelta;
      if ((a.subjectConstraintScore || 0) !== (b.subjectConstraintScore || 0)) {
        return (b.subjectConstraintScore || 0) - (a.subjectConstraintScore || 0);
      }
      if (a.maxConsecDays !== b.maxConsecDays) return a.maxConsecDays - b.maxConsecDays;
      if (a.teacherAvailableSlots !== b.teacherAvailableSlots) {
        return a.teacherAvailableSlots - b.teacherAvailableSlots;
      }
      return 0;
    });

    // 重跑時先對綁班群組再次嘗試群組配對
    if (round === 2) {
      const placedSet = new Set();
      state.blockGroups.forEach(g => {
        if (shouldStopAutoSchedule('retry-bind')) return;
    const subList = typeof g['科目清單'] === 'string' ? g['科目清單'].split(',').map(s => s.trim()).filter(Boolean) : (typeof g['科目代碼'] === 'string' ? g['科目代碼'].split(',').map(s => s.trim()).filter(Boolean) : []);
    const clsList = typeof g['班級清單'] === 'string' ? g['班級清單'].split(',').map(c => c.trim()).filter(Boolean) : (Array.isArray(g['班級清單']) ? g['班級清單'] : (typeof g['班級清單'] === 'number' ? String(g['班級清單']).match(/.{3}/g)||[] : []));
        subList.forEach(sub => {
          // 逐輪重建 byCls，排除已排入者，避免 splice 造成索引偏移
          for (let r = 0; r < retryList.length; r++) {
            if (shouldStopAutoSchedule('retry-bind')) break;
            updateProgress(`第 ${round} 輪綁班群組補配中（第 ${r + 1} 輪）…`);
            const byCls = {};
            retryList.forEach((l, i) => {
              if (placedSet.has(i)) return;
              if (String(l.subjectCode) === sub && clsList.includes(l.classCode)) {
                if (!byCls[l.classCode]) byCls[l.classCode] = [];
                byCls[l.classCode].push(i);
              }
            });
            const clsCodes = Object.keys(byCls).filter(c => byCls[c].length > 0);
            if (clsCodes.length < 2) break;
            if (r >= Math.max(...clsCodes.map(c => byCls[c].length))) break;
            const roundIdx = [];
            clsCodes.forEach(cc => { if (r < byCls[cc].length) roundIdx.push(byCls[cc][r]); });
            if (roundIdx.length < 2) continue;
            const roundLsn = roundIdx.map(i => retryList[i]);
            const repeatedTeachers = getRepeatedTeacherCodes(roundLsn);
            if (repeatedTeachers.length) { console.warn('綁班重跑仍有組內教師衝堂：'+repeatedTeachers.join('、')); continue; }
            const candidates = [];
            const roundLookup = buildScheduleLookup(localSchedule);
            for (let day = 1; day <= 5; day++) {
              for (let per = autoStartPeriod; per <= autoEndPeriod; per++) {
                if (shouldStopAutoSchedule('retry-bind-candidates')) break;
                if (roundLsn.every(l => isSlotValid(l.classCode, l.subjectCode, autoTeacherInput(l), day, per, localSchedule, roundLookup))) {
                  const allBoundTeachersValid = roundLsn.every(l => {
                    const teacherCodes = getAutoTeacherCodes(autoTeacherInput(l));
                    return teacherCodes.every(teacherCode => {
                      const teacherKey = canonicalAutoTeacherCode(teacherCode);
                      const tObj = idx.teacherByCode[teacherKey];
                      const maxC = tObj ? parseInt(tObj['最大連堂節數'] || '2', 10) : 2;
                      return countConsecutiveInLocal(localSchedule, teacherCode, day, per) <= maxC;
                    });
                  });
                  if (allBoundTeachersValid) {
                     const score = roundLsn.reduce((sum, lesson) => sum + evaluateSlotScore(lesson, day, per, true, roundLookup), 0);
                    candidates.push({ day, per, score, tieBreak: autoRandomTieBreak() });
                  }
                }
              }
            }
        if (candidates.length > 0) {
          const best = selectAutoCandidate(candidates, roundLsn);
          roundLsn.forEach((l, gi) => {
              appendLocalSchedule({ '課表ID': 'AUTO_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4) + '_R' + r + '_' + gi, '班級代碼': String(l.classCode), '星期': best.day, '節次': best.per, '科目代碼': String(l.subjectCode), '教師姓名': autoTeacherValue(l), '課堂屬性': getAutoScheduleAttribute(l, best.day, best.per, localSchedule, buildScheduleLookup(localSchedule)), '是否鎖定': 'FALSE', '__isBindGroup': true });
            successCount++;
          });
          roundIdx.forEach(i => placedSet.add(i));
            }
          }
        });
      });
      retryList = retryList.filter((_, i) => !placedSet.has(i));
    }
    if (autoScheduleTimedOut) {
      failList = failList.concat(retryList);
      break;
    }

    for (let ri = 0; ri < retryList.length; ri++) {
      if (shouldStopAutoSchedule('retry-candidates')) {
        failList.push(...retryList.slice(ri));
        break;
      }
      if (ri > 0 && ri % 20 === 0) {
        await yieldToUI();
        updateProgress(`第 ${round} 輪重跑… (${ri}/${retryList.length})`);
      }
      const lesson = retryList[ri];
      // 綁班群組科目在重跑中也禁止個別排入
      if (getBindGroupClasses(lesson.subjectCode, lesson.classCode)) {
        markAutoFailure(lesson, 'bind-group-no-common-slot');
        continue;
      }

      let placed = false;
      const retryLookup = buildScheduleLookup(localSchedule);

      // 補排也使用完整品質分，不再採用第一個合法格位。
      const retryCandidates = [];
      for (let day = 1; day <= 5; day++) {
        for (let per = autoStartPeriod; per <= autoEndPeriod; per++) {
          if (shouldStopAutoSchedule('retry-candidates')) break;
          if (isSlotValid(lesson.classCode, lesson.subjectCode, autoTeacherInput(lesson), day, per, localSchedule, retryLookup)) {
             retryCandidates.push({ day, per, score: evaluateSlotScore(lesson, day, per, true, retryLookup), tieBreak: autoRandomTieBreak() });
          }
        }
      }
      if (retryCandidates.length > 0) {
        const best = selectAutoCandidate(retryCandidates, lesson);
        appendLocalSchedule({
          '課表ID': 'AUTO_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
          '班級代碼': String(lesson.classCode),
          '星期': best.day, '節次': best.per,
          '科目代碼': String(lesson.subjectCode),
          '教師姓名': autoTeacherValue(lesson),
          '課堂屬性': getAutoScheduleAttribute(lesson, best.day, best.per, localSchedule, retryLookup),
          '是否鎖定': 'FALSE'
        });
        successCount++;
        placed = true;
      }
        // 嘗試交換排入（必排可跨班級移動）
      if (!placed && !autoScheduleTimedOut && optSmartSwap) {
        const trySwapAll = lesson.hasMustRule && lesson.mustRuleSlots && lesson.mustRuleSlots.length > 0;
        const movableClassSlots = new Map();
        localSchedule.forEach((entry, entryIndex) => {
          if (String(entry['班級代碼']) !== String(lesson.classCode)) return;
          const entryDay = parseInt(entry['星期'], 10);
          const entryPeriod = parseInt(entry['節次'], 10);
          if (entryDay < 1 || entryDay > 5 || entryPeriod < autoStartPeriod || entryPeriod > autoEndPeriod) return;
          if (String(entry['是否鎖定']).toUpperCase() === 'TRUE') return;
          if (isFrozenAutoEntry(entry) || isMustPlacedCourse(entry) || isBindAutoEntry(entry)) return;
          movableClassSlots.set(entryDay + '|' + entryPeriod, entryIndex);
        });

        for (let day = 1; day <= 5 && !placed; day++) {
          for (let per = autoStartPeriod; per <= autoEndPeriod && !placed; per++) {
            if (shouldStopAutoSchedule('retry-swap')) break;
            if (trySwapAll) {
              const isMustDayPer = lesson.mustRuleSlots.some(s => s.day === day && s.per === per);
              if (!isMustDayPer) continue;
            }

            const occupiedIdx = movableClassSlots.get(day + '|' + per);
            if (occupiedIdx >= 0) {
              const victim = localSchedule[occupiedIdx];
              const tempSched = localSchedule.filter((_, i) => i !== occupiedIdx);
              const tempLookup = buildScheduleLookup(tempSched);
              if (isSlotValid(lesson.classCode, lesson.subjectCode, autoTeacherInput(lesson), day, per, tempSched, tempLookup)) {
                // 同第一輪：用含新課的 lookup 驗證 victim 新位置，防止同班同科同日重複
                const tempSchedWithLesson = [...tempSched, {
                  '班級代碼': String(lesson.classCode),
                  '星期': day, '節次': per,
                  '科目代碼': String(lesson.subjectCode),
                  '教師姓名': autoTeacherValue(lesson)
                }];
                const tempLookupWithLesson = buildScheduleLookup(tempSchedWithLesson);
                let victimCandidate = null;
                for (let newD = 1; newD <= 5 && !placed; newD++) {
                  for (let newP = autoStartPeriod; newP <= autoEndPeriod && !placed; newP++) {
                    if (shouldStopAutoSchedule('retry-swap-candidates')) break;
                    if (newD === day && newP === per) continue;
                    if (isSlotValid(victim['班級代碼'], victim['科目代碼'], victim['教師姓名'], newD, newP, tempSchedWithLesson, tempLookupWithLesson)) {
                      victimCandidate = { newD, newP };
                      break;
                    }
                  }
                  if (victimCandidate) break;
                }
                if (victimCandidate && !placed) {
                  setLocalScheduleEntry(occupiedIdx, { ...victim, '星期': victimCandidate.newD, '節次': victimCandidate.newP });
                  appendLocalSchedule({
                    '課表ID': 'AUTO_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                    '班級代碼': String(lesson.classCode),
                    '星期': day, '節次': per,
                    '科目代碼': String(lesson.subjectCode),
                    '教師姓名': autoTeacherValue(lesson),
                    '課堂屬性': getAutoScheduleAttribute(lesson, day, per, localSchedule, buildScheduleLookup(localSchedule)),
                    '是否鎖定': 'FALSE'
                  });
                  successCount++;
                  placed = true;
                }
              }
            }
          }
        }
      }

      if (!placed) markAutoFailure(lesson, classifyNoLegalSlot(lesson));
    }

  // ── 第四梯隊：直接增廣路徑（只搜尋實際阻塞課，不展開整張課表樹）──────
  markAutoScheduleProfile('repair');
  if (failList.length > 0 && optSmartSwap && !autoScheduleTimedOut) {
    await yieldToUI();
    updateProgress('第四梯隊：直接增廣路徑修復（' + failList.length + ' 節頑固未排課）…');
    const repairStartedAt = Date.now();
    const repairTimeBudgetMs = Math.max(5000, autoScheduleDeadline - repairStartedAt);
    const enableGlobalNeighborhoodRepair = autoScheduleTimeBudgetMs >= 180000;
    repairGlobalReserveMs = enableGlobalNeighborhoodRepair
      ? Math.min(12000, Math.max(3000, Math.floor(repairTimeBudgetMs * 0.25)))
      : 0;
    const repairDirectDeadline = repairStartedAt + Math.max(2000, repairTimeBudgetMs - repairGlobalReserveMs);
    const repairGlobalDeadline = autoScheduleDeadline + repairGlobalReserveMs;
    let repairPhase = 'direct';
    const repairBudgetScale = autoScheduleTimeBudgetMs < 60000
      ? 1
      : Math.min(3, autoScheduleTimeBudgetMs / 60000);
    const repairOperationBase = Math.max(12000, failList.length * 600);
    repairOperationLimit = Math.min(36000, Math.round(repairOperationBase * repairBudgetScale));
    repairOperationReserve = Math.min(6000, Math.floor(repairOperationLimit * 0.25));
    const shouldStopRepair = () => {
      if (repairBudgetExceeded) return true;
      const phaseDeadline = repairPhase === 'global'
        ? repairGlobalDeadline
        : repairDirectDeadline;
      if (Date.now() >= phaseDeadline) {
        if (repairPhase === 'direct') return true;
        repairBudgetExceeded = true;
        console.warn('[AutoSchedule] 增廣路徑修復時間預算已用盡，保留剩餘未排課。');
        return true;
      }
      if (repairPhase !== 'global' && shouldStopAutoSchedule('repair')) return true;
      return false;
    };
    const consumeRepairOperation = (useReserve = false) => {
      if (repairBudgetExceeded) return true;
      if (shouldStopRepair()) return true;
      const operationLimit = useReserve
        ? repairOperationLimit
        : Math.max(0, repairOperationLimit - repairOperationReserve);
      if (repairOperationCount >= operationLimit) {
        if (repairOperationReserve === 0 || useReserve) {
          repairBudgetExceeded = true;
          console.warn('[AutoSchedule] 增廣路徑修復節點上限已用盡，保留剩餘未排課。');
        }
        return true;
      }
      repairOperationCount++;
      if (repairOperationCount >= operationLimit) {
        if (repairOperationReserve === 0 || useReserve) {
          repairBudgetExceeded = true;
          console.warn('[AutoSchedule] 增廣路徑修復節點上限已用盡，保留剩餘未排課。');
        }
        return true;
      }
      return false;
    };
     const repairSearchWide = autoScheduleTimeBudgetMs >= 180000;
     const AUTO_REPAIR_TARGET_LIMIT = repairSearchWide ? 35 : 18;
     const AUTO_REPAIR_RELOCATE_LIMIT = repairSearchWide ? 24 : 12;
     const AUTO_REPAIR_ONE_HOP_LIMIT = repairSearchWide ? 12 : 6;
     const AUTO_REPAIR_MAX_EVICTIONS = repairSearchWide ? 6 : 4;
    const repairPinnedEntries = new Set();

    const isRepairProtectedEntry = entry =>
      !entry || repairPinnedEntries.has(entry) || isFrozenAutoEntry(entry) || isBindAutoEntry(entry);

    function buildRepairEntry(item, day, period) {
      if (item.entryTemplate) return { ...item.entryTemplate, '星期': day, '節次': period };
      return {
        '課表ID': 'AUTO_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        '班級代碼': String(item.lesson.classCode),
        '星期': day,
        '節次': period,
        '科目代碼': String(item.lesson.subjectCode),
        '教師姓名': autoTeacherValue(item.lesson),
        '課堂屬性': getAutoScheduleAttribute(item.lesson, day, period, localSchedule, buildScheduleLookup(localSchedule)),
        '是否鎖定': 'FALSE'
      };
    }

    function collectDirectEvictionOptions(lesson, day, period, allowOptional, providedLookup = null, useReserve = false) {
      if (consumeRepairOperation(useReserve)) return [];
      if (period < autoStartPeriod || period > autoEndPeriod) return [];
      const isHelper = String(lesson.subjectCode || '').trim().endsWith('輔');
      if ((isHelper && period !== 8) || (!isHelper && period === 8)) return [];

      const applicableRules = getApplicableRules(lesson.subjectCode, lesson.classCode);
      if (applicableRules.some(entry => isForbiddenAutoRule(entry.rule) && entry.slots.some(slot => slot.day === day && slot.period === period))) return [];
      const mustRules = applicableRules.filter(entry => isMandatoryAutoRule(entry.rule));
      if (mustRules.length && !mustRules.some(entry => entry.slots.some(slot => slot.day === day && slot.period === period))) return [];

      const teacherIdentities = new Set(resolveAutoTeacherCodes(autoTeacherInput(lesson)));
      if ([...teacherIdentities].some(identity => idx.blockSet.has(identity + '|' + day + '|' + period))) return [];
      const exclusivePeers = new Set();
      teacherIdentities.forEach(identity => {
        (autoTeacherExclusivePeers.get(identity) || []).forEach(peer => exclusivePeers.add(peer));
      });

      const victims = new Set();
      let blocked = false;
      const addVictim = entry => {
        if (!entry || victims.has(entry)) return;
        if (isRepairProtectedEntry(entry)) {
          blocked = true;
          return;
        }
        victims.add(entry);
      };

      const repairLookup = providedLookup || buildScheduleLookup(localSchedule);
      const slotEntries = repairLookup.entriesBySlot.get(day + '|' + period) || [];
      slotEntries.forEach(entry => {
        if (shouldStopRepair()) return;
        if (String(entry['班級代碼']) === String(lesson.classCode)) {
          addVictim(entry);
          return;
        }
        const entryTeachers = resolveAutoTeacherCodes(entry);
        if (entryTeachers.some(identity => teacherIdentities.has(identity) || exclusivePeers.has(identity))) addVictim(entry);
      });
      if (blocked || victims.size > AUTO_REPAIR_MAX_EVICTIONS) return [];

      const addCapacityVictims = (entries, needed) => {
        if (needed <= 0) return true;
        const movable = entries.filter(entry => !victims.has(entry) && !isRepairProtectedEntry(entry));
        if (movable.length < needed) return false;
        movable.slice(0, needed).forEach(entry => victims.add(entry));
        return victims.size <= AUTO_REPAIR_MAX_EVICTIONS;
      };

      const roomCode = getSubjectRoomCode(lesson.subjectCode);
      if (roomCode) {
        const roomEntries = slotEntries.filter(entry =>
          !victims.has(entry) &&
          !isPatrolScheduleEntry(entry) &&
          getSubjectRoomCode(entry['科目代碼']) === roomCode
        );
        if (!addCapacityVictims(roomEntries, roomEntries.length + 1 - getSubjectRoomCapacity(lesson.subjectCode))) return [];
      }

      const subject = idx.subjectByCode[String(lesson.subjectCode)];
      const maxConcurrent = subject ? parseInt(subject['同時最多班數'] || '0', 10) : 0;
      if (maxConcurrent > 0) {
        const subjectEntries = slotEntries.filter(entry =>
          !victims.has(entry) &&
          String(entry['科目代碼']) === String(lesson.subjectCode)
        );
        if (!addCapacityVictims(subjectEntries, subjectEntries.length + 1 - maxConcurrent)) return [];
      }

      const validAfter = evictionList => {
        if (consumeRepairOperation(useReserve)) return false;
        const evictionSet = new Set(evictionList);
        const remaining = localSchedule.filter(entry => !evictionSet.has(entry));
        return isSlotValid(
          lesson.classCode,
          lesson.subjectCode,
          autoTeacherInput(lesson),
          day,
          period,
          remaining,
          buildScheduleLookup(remaining)
        );
      };
      const baseVictims = [...victims];
      if (validAfter(baseVictims)) return [baseVictims];
      if (!allowOptional || baseVictims.length >= AUTO_REPAIR_MAX_EVICTIONS) return [];

      const optionalEntries = localSchedule
        .filter(entry => !victims.has(entry) && !isRepairProtectedEntry(entry))
        .filter(entry => {
          if (shouldStopRepair()) return false;
          const sameClass =
            String(entry['班級代碼']) === String(lesson.classCode);
          const sameClassSubject =
            sameClass && String(entry['科目代碼']) === String(lesson.subjectCode);
          const sameSubject =
            String(entry['科目代碼']) === String(lesson.subjectCode);
          const sameTeacherDay =
            parseInt(entry['星期'], 10) === day &&
            resolveAutoTeacherCodes(entry).some(identity => teacherIdentities.has(identity));
          return sameClass || sameClassSubject || sameSubject || sameTeacherDay;
        })
        .sort((left, right) => {
          const leftDistance = Math.abs(parseInt(left['星期'], 10) - day) + Math.abs(parseInt(left['節次'], 10) - period) / 10;
          const rightDistance = Math.abs(parseInt(right['星期'], 10) - day) + Math.abs(parseInt(right['節次'], 10) - period) / 10;
          return leftDistance - rightDistance;
        })
        .slice(0, 6);

      const options = [];
      for (const optionalEntry of optionalEntries) {
        if (shouldStopRepair()) break;
        const combined = [...baseVictims, optionalEntry];
        if (validAfter(combined)) options.push(combined);
        if (options.length >= 3) break;
      }
      return options;
    }

    function findEmptyCandidates(lesson, limit) {
      const lookup = buildScheduleLookup(localSchedule);
      const candidates = [];
      for (let day = 1; day <= 5; day++) {
        for (let period = autoStartPeriod; period <= autoEndPeriod; period++) {
          if (consumeRepairOperation()) break;
          if (!isSlotValid(lesson.classCode, lesson.subjectCode, autoTeacherInput(lesson), day, period, localSchedule, lookup)) continue;
           candidates.push({ day, period, score: evaluateSlotScore(lesson, day, period, false, lookup), tieBreak: autoRandomTieBreak() });
        }
      }
      return candidates.sort(compareAutoCandidates).slice(0, limit);
    }

    function placeAtFirstEmpty(item, limit) {
      const candidates = findEmptyCandidates(item.lesson, limit);
      if (candidates.length === 0) return false;
       const best = selectAutoCandidate(candidates, item.lesson);
      const placedEntry = buildRepairEntry(item, best.day, best.period);
       appendLocalSchedule(placedEntry);
      repairPinnedEntries.add(placedEntry);
      return true;
    }

     const AUTO_REPAIR_MAX_DEPTH = 4;
     function tryRelocateVictim(victim, depth = 0, visited = new Set()) {
       if (!victim || visited.has(victim)) return false;
       const nextVisited = new Set(visited);
       nextVisited.add(victim);
       const victimLesson = makeAutoLessonFromScheduleEntry(victim, 'augment');
       if (placeAtFirstEmpty({ lesson: victimLesson, entryTemplate: victim }, AUTO_REPAIR_RELOCATE_LIMIT)) return true;
       if (depth >= AUTO_REPAIR_MAX_DEPTH) return false;

        const hopCandidates = [];
        for (let day = 1; day <= 5; day++) {
          for (let period = autoStartPeriod; period <= autoEndPeriod; period++) {
            if (shouldStopRepair()) break;
            const options = collectDirectEvictionOptions(victimLesson, day, period, false);
            options.filter(toEvict =>
              toEvict.length > 0 &&
              toEvict.length <= AUTO_REPAIR_MAX_EVICTIONS &&
              !toEvict.includes(victim)
            ).forEach(toEvict => {
              hopCandidates.push({
                day,
                period,
                blockers: toEvict,
                score: evaluateSlotScore(victimLesson, day, period, false, buildScheduleLookup(localSchedule)) - toEvict.length * 12
              });
            });
          }
        }
        hopCandidates.sort((left, right) => right.score - left.score);
        for (const candidate of hopCandidates.slice(0, AUTO_REPAIR_ONE_HOP_LIMIT)) {
          if (consumeRepairOperation()) break;
          if (candidate.blockers.some(blocker => nextVisited.has(blocker))) continue;
          const scheduleSnapshot = [...localSchedule];
          const pinnedSnapshot = new Set(repairPinnedEntries);
          const blockerIndexes = candidate.blockers
            .map(blocker => localSchedule.indexOf(blocker))
            .filter(index => index >= 0)
            .sort((left, right) => right - left);
          if (blockerIndexes.length !== candidate.blockers.length) continue;
          blockerIndexes.forEach(index => removeLocalScheduleAt(index));

         const lookup = buildScheduleLookup(localSchedule);
         if (!isSlotValid(
           victimLesson.classCode,
           victimLesson.subjectCode,
           autoTeacherInput(victimLesson),
           candidate.day,
           candidate.period,
           localSchedule,
           lookup
         )) {
           replaceLocalSchedule(scheduleSnapshot);
           continue;
         }

           const movedVictim = buildRepairEntry({ lesson: victimLesson, entryTemplate: victim }, candidate.day, candidate.period);
           appendLocalSchedule(movedVictim);
           repairPinnedEntries.add(movedVictim);
           let blockersSolved = true;
           const blockerVisited = new Set(nextVisited);
           for (const blocker of candidate.blockers) {
             if (blockerVisited.has(blocker) || !tryRelocateVictim(blocker, depth + 1, blockerVisited)) {
               blockersSolved = false;
               break;
             }
             blockerVisited.add(blocker);
           }
           if (blockersSolved) return true;

          replaceLocalSchedule(scheduleSnapshot);
         repairPinnedEntries.clear();
         pinnedSnapshot.forEach(entry => repairPinnedEntries.add(entry));
        }
       return false;
       }

      function tryConflictGraphLesson(lesson) {
        conflictGraphStats.searches++;
        if (!lesson || shouldStopRepair()) return false;
        const graphNodeLimit = repairSearchWide ? 6000 : 3000;
        const graphTargetLimit = repairSearchWide ? 50 : 24;
        const graphBranchLimit = repairSearchWide ? 24 : 12;
        let graphNodes = 0;
        const finish = result => {
          conflictGraphStats.nodes += graphNodes;
          return result;
        };

        const candidateKey = candidate => [
          candidate.day,
          candidate.period,
          candidate.blockers.map(entry => getAutoScheduleIdentity(entry)).sort().join('~')
        ].join('|');
        const compareGraphCandidates = (left, right) =>
          left.blockers.length - right.blockers.length || compareAutoCandidates(left, right);
        const collectGraphCandidates = (targetLesson, allowOptional, excludedEntry = null) => {
          const lookup = buildScheduleLookup(localSchedule);
          const candidates = [];
          const seen = new Set();
          for (let day = 1; day <= 5; day++) {
            for (let period = autoStartPeriod; period <= autoEndPeriod; period++) {
              if (shouldStopRepair()) return candidates.sort(compareGraphCandidates);
              const options = collectDirectEvictionOptions(targetLesson, day, period, allowOptional, lookup);
              options.forEach(blockers => {
                if (excludedEntry && blockers.includes(excludedEntry)) return;
                const uniqueBlockers = [...new Set(blockers)];
                if (uniqueBlockers.length > AUTO_REPAIR_MAX_EVICTIONS) return;
                const candidate = {
                  day,
                  period,
                  blockers: uniqueBlockers,
                  score: evaluateSlotScore(targetLesson, day, period, false, lookup) - uniqueBlockers.length * 20,
                  tieBreak: autoRandomTieBreak()
                };
                const key = candidateKey(candidate);
                if (seen.has(key)) return;
                seen.add(key);
                candidates.push(candidate);
                conflictGraphStats.candidates++;
              });
            }
          }
          return candidates.sort(compareGraphCandidates);
        };

        const relocate = (victim, visitedEntries) => {
          if (!victim || visitedEntries.has(victim) || shouldStopRepair()) return false;
          if (++graphNodes > graphNodeLimit) return false;
          const nextVisited = new Set(visitedEntries);
          nextVisited.add(victim);
          const victimLesson = makeAutoLessonFromScheduleEntry(victim, 'conflict_graph');
          const candidates = collectGraphCandidates(victimLesson, false, victim);

          for (const candidate of candidates.slice(0, graphBranchLimit)) {
            if (++graphNodes > graphNodeLimit || shouldStopRepair()) return false;
            if (candidate.blockers.some(blocker => nextVisited.has(blocker))) continue;
            const scheduleSnapshot = [...localSchedule];
            const pinnedSnapshot = new Set(repairPinnedEntries);
            const blockerIndexes = candidate.blockers
              .map(blocker => localSchedule.indexOf(blocker))
              .filter(index => index >= 0)
              .sort((left, right) => right - left);
            if (blockerIndexes.length !== candidate.blockers.length) continue;
            blockerIndexes.forEach(index => removeLocalScheduleAt(index));

            const lookup = buildScheduleLookup(localSchedule);
            if (!isSlotValid(
              victimLesson.classCode,
              victimLesson.subjectCode,
              autoTeacherInput(victimLesson),
              candidate.day,
              candidate.period,
              localSchedule,
              lookup
            )) {
              replaceLocalSchedule(scheduleSnapshot);
              continue;
            }

            const movedVictim = buildRepairEntry({ lesson: victimLesson, entryTemplate: victim }, candidate.day, candidate.period);
            appendLocalSchedule(movedVictim);
            repairPinnedEntries.add(movedVictim);
            let blockersSolved = true;
            const branchVisited = new Set(nextVisited);
            for (const blocker of candidate.blockers) {
              if (branchVisited.has(blocker) || !relocate(blocker, branchVisited)) {
                blockersSolved = false;
                break;
              }
              branchVisited.add(blocker);
            }
            if (blockersSolved) return true;

            replaceLocalSchedule(scheduleSnapshot);
            repairPinnedEntries.clear();
            pinnedSnapshot.forEach(entry => repairPinnedEntries.add(entry));
          }
          return false;
        };

        const rootCandidates = collectGraphCandidates(lesson, false);
        for (const candidate of rootCandidates.slice(0, graphTargetLimit)) {
          if (++graphNodes > graphNodeLimit || shouldStopRepair()) return finish(false);
          repairPinnedEntries.clear();
          const scheduleSnapshot = [...localSchedule];
          const pinnedSnapshot = new Set(repairPinnedEntries);
          const blockerIndexes = candidate.blockers
            .map(blocker => localSchedule.indexOf(blocker))
            .filter(index => index >= 0)
            .sort((left, right) => right - left);
          if (blockerIndexes.length !== candidate.blockers.length) continue;
          blockerIndexes.forEach(index => removeLocalScheduleAt(index));

          const lookup = buildScheduleLookup(localSchedule);
          if (!isSlotValid(
            lesson.classCode,
            lesson.subjectCode,
            autoTeacherInput(lesson),
            candidate.day,
            candidate.period,
            localSchedule,
            lookup
          )) {
            replaceLocalSchedule(scheduleSnapshot);
            pinnedSnapshot.forEach(entry => repairPinnedEntries.add(entry));
            continue;
          }

          const placedLesson = buildRepairEntry({ lesson, entryTemplate: null }, candidate.day, candidate.period);
          appendLocalSchedule(placedLesson);
          repairPinnedEntries.add(placedLesson);
          let solved = true;
          const visitedEntries = new Set();
          for (const blocker of candidate.blockers) {
            if (visitedEntries.has(blocker) || !relocate(blocker, visitedEntries)) {
              solved = false;
              break;
            }
            visitedEntries.add(blocker);
          }
          if (solved) {
            conflictGraphMoves++;
            return finish(true);
          }

          replaceLocalSchedule(scheduleSnapshot);
          repairPinnedEntries.clear();
          pinnedSnapshot.forEach(entry => repairPinnedEntries.add(entry));
        }
        return finish(false);
      }

      function tryRepackClassLesson(lesson) {
        const classCode = String(lesson?.classCode || '');
        if (!lesson || !autoTightClassCodes.has(classCode)) return false;
        const movableEntries = localSchedule.filter(entry => {
          if (String(entry['班級代碼'] || '') !== classCode) return false;
          const period = parseInt(entry['節次'], 10);
          if (period < autoStartPeriod || period > autoEndPeriod || isPatrolScheduleEntry(entry)) return false;
          return !isRepairProtectedEntry(entry) && !isMustPlacedCourse(entry);
        });
        const movableSet = new Set(movableEntries);
        const baseSchedule = localSchedule.filter(entry => !movableSet.has(entry));
        const baseLookup = buildScheduleLookup(baseSchedule);
        const classSlots = [];
        for (let day = 1; day <= 5; day++) {
          for (let period = autoStartPeriod; period <= autoEndPeriod; period++) {
            classSlots.push({ day, period });
          }
        }
        const items = [
          { lesson, entryTemplate: null, isTarget: true },
          ...movableEntries.map(entry => ({
            lesson: makeAutoLessonFromScheduleEntry(entry, 'class_repack'),
            entryTemplate: entry,
            isTarget: false
          }))
        ];
        if (items.length > classSlots.length) return false;

        const itemCandidates = [];
        for (const item of items) {
          if (shouldStopRepair()) return false;
          const candidates = [];
          for (const slot of classSlots) {
            if (consumeRepairOperation()) return false;
            if (!isSlotValid(
              item.lesson.classCode,
              item.lesson.subjectCode,
              autoTeacherInput(item.lesson),
              slot.day,
              slot.period,
              baseSchedule,
              baseLookup
            )) continue;
            candidates.push({
              ...slot,
              score: evaluateSlotScore(item.lesson, slot.day, slot.period, false, baseLookup),
              tieBreak: autoRandomTieBreak()
            });
          }
          if (candidates.length === 0) return false;
          candidates.sort(compareAutoCandidates);
          itemCandidates.push({ item, candidates });
        }
        itemCandidates.sort((left, right) =>
          left.candidates.length - right.candidates.length ||
          Number(right.item.isTarget) - Number(left.item.isTarget) ||
          getAutoConflictPressure(right.item.lesson) - getAutoConflictPressure(left.item.lesson)
        );

        const workingSchedule = [...baseSchedule];
        const assignedSlots = new Set();
        const assignedEntries = [];
        let searchNodes = 0;
        const CLASS_REPACK_NODE_LIMIT = 1500;
        const search = depth => {
          if (depth >= itemCandidates.length) return true;
          if (++searchNodes > CLASS_REPACK_NODE_LIMIT || shouldStopRepair()) return false;
          const { item, candidates } = itemCandidates[depth];
          const lookup = buildScheduleLookup(workingSchedule);
          for (const candidate of candidates) {
            const slotKey = candidate.day + '|' + candidate.period;
            if (assignedSlots.has(slotKey)) continue;
            if (consumeRepairOperation()) return false;
            if (!isSlotValid(
              item.lesson.classCode,
              item.lesson.subjectCode,
              autoTeacherInput(item.lesson),
              candidate.day,
              candidate.period,
              workingSchedule,
              lookup
            )) continue;
            const entry = item.entryTemplate
              ? { ...item.entryTemplate, '星期': candidate.day, '節次': candidate.period }
              : {
                '班級代碼': String(item.lesson.classCode),
                '星期': candidate.day,
                '節次': candidate.period,
                '科目代碼': String(item.lesson.subjectCode),
                 '教師姓名': autoTeacherValue(item.lesson),
                 '課堂屬性': getAutoScheduleAttribute(item.lesson, candidate.day, candidate.period, workingSchedule, lookup),
                 '是否鎖定': 'FALSE'
              };
            workingSchedule.push(entry);
            assignedSlots.add(slotKey);
            assignedEntries.push({ item, day: candidate.day, period: candidate.period });
            if (search(depth + 1)) return true;
            assignedEntries.pop();
            assignedSlots.delete(slotKey);
            workingSchedule.pop();
          }
          return false;
        };

        if (!search(0)) return false;
        const finalEntries = assignedEntries.map(assignment =>
          buildRepairEntry(assignment.item, assignment.day, assignment.period)
        );
        replaceLocalSchedule(baseSchedule);
        finalEntries.forEach(entry => {
          appendLocalSchedule(entry);
          repairPinnedEntries.add(entry);
        });
        console.log('  🧩 班級局部重排完成：' + classCode + '，重排 ' + movableEntries.length + ' 節並排入 ' + String(lesson.subjectCode));
        return true;
      }

    function tryAugmentLesson(lesson) {
      const targetCandidates = [];
      for (let day = 1; day <= 5; day++) {
        for (let period = autoStartPeriod; period <= autoEndPeriod; period++) {
          if (consumeRepairOperation()) break;
          const options = collectDirectEvictionOptions(lesson, day, period, true);
          options.forEach(toEvict => {
            targetCandidates.push({
              day,
              period,
              toEvict,
               score: evaluateSlotScore(lesson, day, period, false, buildScheduleLookup(localSchedule)) - toEvict.length * 25,
              tieBreak: autoRandomTieBreak()
            });
          });
        }
      }
      targetCandidates.sort((left, right) =>
        left.toEvict.length - right.toEvict.length ||
        compareAutoCandidates(left, right)
      );

      for (const candidate of targetCandidates.slice(0, AUTO_REPAIR_TARGET_LIMIT)) {
        const scheduleSnapshot = [...localSchedule];
        repairPinnedEntries.clear();
        const evictedSet = new Set(candidate.toEvict);
        replaceLocalSchedule(scheduleSnapshot.filter(entry => !evictedSet.has(entry)));

        const lookup = buildScheduleLookup(localSchedule);
        if (!isSlotValid(
          lesson.classCode,
          lesson.subjectCode,
          autoTeacherInput(lesson),
          candidate.day,
          candidate.period,
          localSchedule,
          lookup
        )) {
          replaceLocalSchedule(scheduleSnapshot);
          continue;
        }

        const placedLesson = buildRepairEntry({ lesson, entryTemplate: null }, candidate.day, candidate.period);
        appendLocalSchedule(placedLesson);
        repairPinnedEntries.add(placedLesson);
        let solved = true;
        for (const victim of candidate.toEvict) {
          if (shouldStopRepair()) {
            solved = false;
            break;
          }
          if (!tryRelocateVictim(victim)) {
            solved = false;
            break;
          }
        }
        if (solved) return true;

        replaceLocalSchedule(scheduleSnapshot);
        repairPinnedEntries.clear();
      }
      return false;
    }

    function runAutoNeighborhoodRepair(targetOverride = null) {
      if (failList.length === 0 || shouldStopRepair()) return 0;
      neighborhoodRepairStats.attempts++;
      repairPinnedEntries.clear();
      const targetPool = Array.isArray(targetOverride)
        ? targetOverride.filter(lesson => failList.includes(lesson))
        : failList;
      const targetLessons = [...targetPool]
        .sort((left, right) => getAutoConflictPressure(right) - getAutoConflictPressure(left) ||
          (Number(left.teacherAvailableSlots) || 0) - (Number(right.teacherAvailableSlots) || 0))
        .slice(0, 8);
      const targetClasses = new Set(targetLessons.map(lesson => String(lesson.classCode || '')));
      const targetSubjects = new Set(targetLessons.map(lesson => String(lesson.subjectCode || '')));
      const targetTeachers = new Set(targetLessons.flatMap(lesson =>
        getAutoTeacherCodes(autoTeacherInput(lesson)).map(teacherCode => canonicalAutoTeacherCode(teacherCode))
      ));
      const targetRooms = new Set(targetLessons.map(lesson => getSubjectRoomCode(lesson.subjectCode)).filter(Boolean));
       const sharesNeighborhood = entry => {
        if (isRepairProtectedEntry(entry)) return false;
        const entryTeachers = new Set(getAutoTeacherCodes(entry).map(teacherCode => canonicalAutoTeacherCode(teacherCode)));
        return targetClasses.has(String(entry['班級代碼'] || '')) ||
          targetSubjects.has(String(entry['科目代碼'] || '')) ||
          targetRooms.has(getSubjectRoomCode(entry['科目代碼'])) ||
           [...entryTeachers].some(teacherCode => targetTeachers.has(teacherCode));
       };
       const blockerEntries = new Set();
       const seedOptions = [];
       const blockerLookup = buildScheduleLookup(localSchedule);
       for (const lesson of targetLessons) {
         const lessonSeedOptions = [];
         for (let day = 1; day <= 5 && lessonSeedOptions.length < 3; day++) {
           for (let period = autoStartPeriod; period <= autoEndPeriod && lessonSeedOptions.length < 3; period++) {
             if (shouldStopRepair()) break;
               collectDirectEvictionOptions(lesson, day, period, true, blockerLookup, true)
                 .forEach(blockers => {
                   if (lessonSeedOptions.length >= 3) return;
                   const uniqueBlockers = [...new Set(blockers)].filter(entry =>
                     entry && !isRepairProtectedEntry(entry)
                   );
                   if (uniqueBlockers.length === blockers.length) {
                     lessonSeedOptions.push({ lesson, blockers: uniqueBlockers });
                   }
                 });
           }
         }
         seedOptions.push(...lessonSeedOptions);
       }
       targetLessons.forEach(lesson => {
         seedOptions
           .filter(option => option.lesson === lesson)
           .sort((left, right) => left.blockers.length - right.blockers.length)
            .slice(0, 1)
            .forEach(option => option.blockers.forEach(entry => blockerEntries.add(entry)));
       });
       const fallbackNeighborhood = seedOptions.length === 0
         ? localSchedule.filter(sharesNeighborhood)
         : [];
       const destroyedEntries = [...new Set([
          ...blockerEntries,
          ...fallbackNeighborhood
        ])].slice(0, 24);
       if (destroyedEntries.length === 0 && seedOptions.length === 0) return 0;

      const scheduleSnapshot = [...localSchedule];
      const failSnapshot = [...failList];
      const destroyedSet = new Set(destroyedEntries);
      const destroyedItems = destroyedEntries.map(entry => ({
        lesson: makeAutoLessonFromScheduleEntry(entry, 'neighborhood'),
        entryTemplate: entry,
        isTarget: false
      }));
      const repairItems = targetLessons.map(lesson => ({ lesson, entryTemplate: null, isTarget: true })).concat(destroyedItems);
      neighborhoodRepairStats.maxItems = Math.max(neighborhoodRepairStats.maxItems, repairItems.length);
      const baseSchedule = scheduleSnapshot.filter(entry => !destroyedSet.has(entry));
      const baseLookup = buildScheduleLookup(baseSchedule);
      const itemCandidates = [];
      for (const item of repairItems) {
        if (shouldStopRepair()) return 0;
        const candidates = [];
        for (let day = 1; day <= 5; day++) {
          for (let period = autoStartPeriod; period <= autoEndPeriod; period++) {
            if (consumeRepairOperation(true)) return 0;
            if (!isSlotValid(item.lesson.classCode, item.lesson.subjectCode, autoTeacherInput(item.lesson), day, period, baseSchedule, baseLookup)) continue;
            candidates.push({
              day,
              period,
              score: evaluateSlotScore(item.lesson, day, period, false, baseLookup),
              tieBreak: autoRandomTieBreak()
            });
          }
        }
        if (candidates.length === 0) {
          neighborhoodRepairStats.candidateWipeouts++;
          return 0;
        }
        candidates.sort(compareAutoCandidates);
        itemCandidates.push({ item, candidates });
      }
      itemCandidates.sort((left, right) =>
        left.candidates.length - right.candidates.length ||
        Number(right.item.isTarget) - Number(left.item.isTarget) ||
        getAutoConflictPressure(right.item.lesson) - getAutoConflictPressure(left.item.lesson)
      );

      const workingSchedule = [...baseSchedule];
      const assignedEntries = [];
      const NEIGHBORHOOD_NODE_LIMIT = 2500;
      let searchNodes = 0;
      const search = depth => {
        if (depth >= itemCandidates.length) return true;
        if (++searchNodes > NEIGHBORHOOD_NODE_LIMIT || shouldStopRepair()) return false;
        const { item, candidates } = itemCandidates[depth];
        const lookup = buildScheduleLookup(workingSchedule);
        for (const candidate of candidates) {
          if (consumeRepairOperation(true)) return false;
          if (!isSlotValid(item.lesson.classCode, item.lesson.subjectCode, autoTeacherInput(item.lesson), candidate.day, candidate.period, workingSchedule, lookup)) continue;
          const entry = item.entryTemplate
            ? { ...item.entryTemplate, '星期': candidate.day, '節次': candidate.period }
            : {
              '班級代碼': String(item.lesson.classCode),
              '星期': candidate.day,
              '節次': candidate.period,
              '科目代碼': String(item.lesson.subjectCode),
               '教師姓名': autoTeacherValue(item.lesson),
               '課堂屬性': getAutoScheduleAttribute(item.lesson, candidate.day, candidate.period, workingSchedule, lookup),
               '是否鎖定': 'FALSE'
            };
          workingSchedule.push(entry);
          assignedEntries.push({ item, day: candidate.day, period: candidate.period });
          if (search(depth + 1)) return true;
          assignedEntries.pop();
          workingSchedule.pop();
        }
        return false;
      };

      if (!search(0)) {
        neighborhoodRepairStats.searchNodes += searchNodes;
        neighborhoodRepairStats.searchFailures++;
        return 0;
      }
      neighborhoodRepairStats.searchNodes += searchNodes;
      const finalEntries = assignedEntries.map(assignment =>
        buildRepairEntry(assignment.item, assignment.day, assignment.period)
      );
      replaceLocalSchedule(baseSchedule);
      finalEntries.forEach(entry => {
        appendLocalSchedule(entry);
        repairPinnedEntries.add(entry);
      });
      const targetSet = new Set(targetLessons);
      const candidateFailList = failSnapshot.filter(lesson => !targetSet.has(lesson));
      if (candidateFailList.length < failSnapshot.length) {
        failList = candidateFailList;
        successCount += targetLessons.length;
        neighborhoodRepairMoves += destroyedEntries.length;
        neighborhoodRepairStats.successes++;
        console.log('  🧩 局部回溯重建完成：排入 ' + targetLessons.length + ' 節，移動 ' + destroyedEntries.length + ' 節，剩餘未排 ' + failList.length + ' 節');
        return targetLessons.length;
      }

      replaceLocalSchedule(scheduleSnapshot);
      failList = failSnapshot;
      return 0;
    }

    function runAutoGlobalNeighborhoodRepair() {
      if (failList.length === 0 || shouldStopRepair()) return 0;
      const failures = failList.filter(lesson => !getBindGroupClasses(lesson.subjectCode, lesson.classCode));
      if (failures.length === 0) return 0;

      const parent = new Map(failures.map(lesson => [lesson, lesson]));
      const findRoot = lesson => {
        let root = lesson;
        while (parent.get(root) !== root) {
          parent.set(root, parent.get(parent.get(root)));
          root = parent.get(root);
        }
        return root;
      };
      const union = (left, right) => {
        const leftRoot = findRoot(left);
        const rightRoot = findRoot(right);
        if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
      };
      const keyOwners = new Map();
      failures.forEach(lesson => {
        const keys = [
          'class|' + String(lesson.classCode || ''),
          ...getAutoTeacherCodes(autoTeacherInput(lesson)).map(code => 'teacher|' + canonicalAutoTeacherCode(code))
        ];
        const roomCode = getSubjectRoomCode(lesson.subjectCode);
        if (roomCode) keys.push('room|' + roomCode);
        const subject = idx.subjectByCode[String(lesson.subjectCode || '')];
        if (subject && parseInt(subject['同時最多班數'] || '0', 10) > 0) {
          keys.push('subject|' + String(lesson.subjectCode || ''));
        }
        keys.filter(key => !key.endsWith('|')).forEach(key => {
          const owner = keyOwners.get(key);
          if (owner) union(lesson, owner);
          else keyOwners.set(key, lesson);
        });
      });

      const components = new Map();
      failures.forEach(lesson => {
        const root = findRoot(lesson);
        if (!components.has(root)) components.set(root, []);
        components.get(root).push(lesson);
      });
      const orderedComponents = [...components.values()].sort((left, right) =>
        Math.max(...right.map(getAutoConflictPressure)) - Math.max(...left.map(getAutoConflictPressure)) ||
        right.length - left.length
      );
      let moved = 0;
      for (const component of orderedComponents) {
        for (let offset = 0; offset < component.length; offset += 6) {
          if (shouldStopRepair()) return moved;
          const before = failList.length;
          const chunk = component.slice(offset, offset + 8);
          globalMatchingPasses++;
          const result = runAutoNeighborhoodRepair(chunk);
          if (result > 0) moved += result;
          if (failList.length === before && result === 0 && offset + 8 >= component.length) break;
        }
      }
      return moved;
    }

    failList.sort((left, right) =>
      getAutoConflictPressure(right) - getAutoConflictPressure(left) ||
      (Number(right.priorityScore) || 0) - (Number(left.priorityScore) || 0) ||
      (Number(right.subjectConstraintScore) || 0) - (Number(left.subjectConstraintScore) || 0) ||
      (Number(left.teacherAvailableSlots) || 0) - (Number(right.teacherAvailableSlots) || 0)
    );
    const repairRemain = [];
    for (let repairIndex = 0; repairIndex < failList.length; repairIndex++) {
      if (shouldStopRepair()) {
        repairRemain.push(...failList.slice(repairIndex));
        break;
      }
      const lesson = failList[repairIndex];
      await yieldToUI();
      updateProgress('第四梯隊：直接增廣路徑修復（' + (repairIndex + 1) + '/' + failList.length + '）…');
      if (getBindGroupClasses(lesson.subjectCode, lesson.classCode)) {
        lesson.failureReason = 'bind-group-no-common-slot';
        repairRemain.push(lesson);
        continue;
      }
      const isTightClass = autoTightClassCodes.has(String(lesson.classCode || ''));
      const repaired = isTightClass
        ? (tryConflictGraphLesson(lesson) || tryRepackClassLesson(lesson) || tryAugmentLesson(lesson))
        : (tryConflictGraphLesson(lesson) || tryAugmentLesson(lesson) || tryRepackClassLesson(lesson));
      if (repaired) {
        successCount++;
        console.log('  ✅ 修復排入：' + lesson.subjectCode + '（' + lesson.classCode + '）');
      } else {
        lesson.failureReason = classifyNoLegalSlot(lesson, 'cascade-no-legal-slot');
        repairRemain.push(lesson);
      }
    }
    failList = repairRemain;
    if (enableGlobalNeighborhoodRepair && repairGlobalReserveMs > 0) {
      repairPhase = 'global';
      runAutoGlobalNeighborhoodRepair();
    }
    console.log('  🔗 直接增廣路徑完成，剩餘未排：' + failList.length + ' 節');
  }
  }

  // ── 空堂優化後處理：掃描教師空堂，嘗試平移相鄰課填補 ─────────────────
  markAutoScheduleProfile('gap');
  await yieldToUI();
  updateProgress('空堂優化後處理中…');
  {
    const GAP_OPT_PASSES = 3;
    for (let pass = 0; pass < GAP_OPT_PASSES; pass++) {
      if (shouldStopAutoSchedule('gap')) break;
      let improved = false;
      let gapLookup = buildScheduleLookup(localSchedule);
      // 收集全部教師
      const teacherHasBlock = (teacherValue, day, period) =>
        resolveAutoTeacherCodes(teacherValue).some(identity => idx.blockSet.has(identity + '|' + day + '|' + period));
      const teacherSet = new Set();
      localSchedule.forEach(entry => {
        resolveAutoTeacherCodes(entry).forEach(identity => {
          const canonical = canonicalAutoTeacherCode(identity);
          if (canonical) teacherSet.add(canonical);
        });
      });
      for (const tcCode of teacherSet) {
        if (shouldStopAutoSchedule('gap')) break;
        // 找這位教師今天有空堂的日子
        for (let day = 1; day <= 5; day++) {
          const dayItems = (gapLookup.teacherDayEntries.get(tcCode + '|' + day) || [])
            .map(s => ({ s, i: localSchedule.indexOf(s) }))
            .filter(({s, i}) => i >= 0 && autoTeacherMatches(s, tcCode) && parseInt(s['節次'],10)>=autoStartPeriod && parseInt(s['節次'],10)<=autoEndPeriod && parseInt(s['節次'],10)<=7);
          if (dayItems.length < 2) continue;
          const periods = dayItems.map(({s})=>parseInt(s['節次'],10)).sort((a,b)=>a-b);
          const periodSet = new Set(periods);
          const first = periods[0], last = periods[periods.length-1];
          // 找出真正的空堂（中間未被鎖定也不是不排課）
          const gaps = [];
          for (let p = first+1; p < last; p++) {
            if (!periodSet.has(p) && !teacherHasBlock(tcCode, day, p)) gaps.push(p);
          }
           if (gaps.length === 0) continue;
           // 嘗試把空堂旁邊的課挪到空堂格位（同班、同教師、無衝堂）
           for (const gapP of gaps) {
            if (shouldStopAutoSchedule('gap')) break;
             // 找能移入空堂的課：同天已排課中找一節「移到 gapP 後合法且不造成新空堂」的
             for (const {s: cand, i: candIdx} of dayItems) {
              if (shouldStopAutoSchedule('gap')) break;
              const candP = parseInt(cand['節次'],10);
              if (candP === gapP) continue;
              if (isFrozenAutoEntry(cand) || isBindAutoEntry(cand)) continue;
              // 要移到 gapP：先確認班級格位未被占
              const schedNoC = localSchedule.filter((_,i)=>i!==candIdx);
              const lkNoC = buildScheduleLookup(schedNoC);
              if (!isSlotValid(cand['班級代碼'],cand['科目代碼'],autoTeacherInput({ teacherCodes: getAutoTeacherCodes(cand), teacherCode: cand['教師姓名'] }),day,gapP,schedNoC,lkNoC)) continue;
              // 連堂保護：依教師「最大連堂節數」設定判斷，與排課邏輯一致
              const exceedsTeacherConsecutive = getAutoTeacherCodes(cand).some(teacherToken => {
                const teacherKey = canonicalAutoTeacherCode(teacherToken);
                const teacherGap = idx.teacherByCode[teacherKey];
                const maxConsecGap = teacherGap ? parseInt(teacherGap['最大連堂節數']||'2',10) : 2;
                 const dayPeriodsGap = (gapLookup.teacherDayEntries.get(teacherKey + '|' + day) || [])
                   .filter(s=>s!==cand&&parseInt(s['節次'],10)>=autoStartPeriod&&parseInt(s['節次'],10)<=autoEndPeriod&&parseInt(s['節次'],10)<=7)
                  .map(s=>parseInt(s['節次'],10))
                  .filter(p=>p!==candP); // 移除 cand 原位置
                dayPeriodsGap.push(gapP); // 加入新位置
                const projSet = new Set(dayPeriodsGap);
                let maxStreak = 1, curStreak = 1;
                const sorted = [...projSet].sort((a,b)=>a-b);
                for (let si=1;si<sorted.length;si++) { curStreak = sorted[si]===sorted[si-1]+1 ? curStreak+1 : 1; maxStreak = Math.max(maxStreak,curStreak); }
                return maxStreak > maxConsecGap;
              });
              if (exceedsTeacherConsecutive) continue; // 移動會超過任一教師的連堂上限，跳過
              // 計算移動前後的教師空堂數
              const periodsAfter = periods.filter(p=>p!==candP);
              periodsAfter.push(gapP);
              periodsAfter.sort((a,b)=>a-b);
              const gapsBefore = gaps.length;
              const periodsAfterSet = new Set(periodsAfter);
              const firstA=periodsAfter[0], lastA=periodsAfter[periodsAfter.length-1];
              let gapsAfter=0;
              for(let p=firstA+1;p<lastA;p++) if(!periodsAfterSet.has(p)&&!teacherHasBlock(tcCode, day, p)) gapsAfter++;
              // 只有確實減少空堂才執行
               if (gapsAfter < gapsBefore) {
                 setLocalScheduleEntry(candIdx, {...cand, '節次': gapP});
                 gapLookup = buildScheduleLookup(localSchedule);
                 improved = true;
                break; // 本空堂已填，跳到下一個空堂
              }
            }
          }
        }
      }
      if (!improved) break;
    }
    console.log('  ✨ 空堂優化後處理完成');
  }

  if (failList.length === 0 && Date.now() >= autoScheduleDeadline) {
    autoScheduleQualityGraceActive = true;
    autoScheduleQualityDeadline = Date.now() + 12000;
    autoScheduleTimedOut = false;
    console.log('  ✨ 已排入全部課程，啟用 12 秒品質收尾時間');
  }

  // 3.5 排課完成後的局部最佳化：只調整本次自動產生且未鎖定的課程。
  markAutoScheduleProfile('local-optimization');
  let localOptimizationMoves = 0;
  async function optimizeAutoScheduleLocally() {
    const originalScheduleIds = new Set(
      state.schedule.map(s => String(s['課表ID'] || '')).filter(Boolean)
    );
    const localOptPasses = autoScheduleTimeBudgetMs >= 180000 ? 2 : 1;
    const maxSwapPairsPerPass = autoScheduleTimeBudgetMs >= 180000 ? 5000 : 1800;

    const isAutoMovableEntry = (entry) => {
      const id = String(entry['課表ID'] || '');
      if (!id || originalScheduleIds.has(id)) return false;
      if (isFrozenAutoEntry(entry)) return false;
      if (isBindAutoEntry(entry)) return false;
      const period = parseInt(entry['節次'], 10);
      return Number.isFinite(period) && period >= autoStartPeriod && period <= autoEndPeriod;
    };

    const readLocalQuality = schedule => {
      const auditFn = typeof buildAutoScheduleQualityReport === 'function'
      ? buildAutoScheduleQualityReport
      : (typeof window !== 'undefined' && typeof window.buildAutoScheduleQualityReport === 'function' ? window.buildAutoScheduleQualityReport : null);
    if (!auditFn) return null;
    return auditFn({
        schedule,
        optP8Only,
        autoEndPeriod,
        onePerDay: optOnePerDay,
          ignoreTeacherConsecutiveIds: [...originalScheduleIds]
      });
    };
    const compareLocalQuality = (left, right) => {
      if (!left || !right) return 0;
      const leftViolations = Array.isArray(left.violations) ? left.violations.length : 0;
      const rightViolations = Array.isArray(right.violations) ? right.violations.length : 0;
      if (leftViolations !== rightViolations) return leftViolations - rightViolations;
      const leftRemaining = Number(left.remainingLessons) || 0;
      const rightRemaining = Number(right.remainingLessons) || 0;
      if (leftRemaining !== rightRemaining) return leftRemaining - rightRemaining;
      for (const metric of [
        'teacherGaps',
        'teacherImbalance',
        'subjectRelationSoftViolations',
        'teacherLongStreaks',
        'teacherRepeatedPeriods',
        'teacherAfternoonOverload',
        'teacherCrossGradeSameDay',
        'teacherCrossGradeAdjacent'
      ]) {
        const leftValue = Number(left[metric]) || 0;
        const rightValue = Number(right[metric]) || 0;
        if (leftValue !== rightValue) return leftValue - rightValue;
      }
      return (Number(right.score) || 0) - (Number(left.score) || 0);
    };

    const entryToLesson = (entry) => {
      const classCode = String(entry['班級代碼'] || '');
      const subjectCode = String(entry['科目代碼'] || '').trim();
      const teacherCodes = getAutoTeacherCodes(entry);
      const teacherCode = teacherCodes[0] || String(entry['教師姓名'] || '');
      const subject = idx.subjectByCode[subjectCode];
      const totalWeekly = weeklyTargetByClassSubject.get(classCode + '|' + subjectCode) || 1;
      return {
        classCode,
        subjectCode,
        teacherCode,
        teacherCodes,
        teacherValue: teacherCodes.length > 1 ? teacherCodes : teacherCode,
         totalWeekly,
         weeklyUnit: isAlternateWeekScheduleEntry(entry) ? 0.5 : 1,
         isAlternateWeek: isAlternateWeekScheduleEntry(entry) || isAlternateClassSubject(classCode, subjectCode),
         isP8Lesson: isAlternateWeekScheduleEntry(entry) || isAlternateClassSubject(classCode, subjectCode) || isHelperSubjectCode(subjectCode),
         weekType: isAlternateWeekScheduleEntry(entry) ? String(entry['課堂屬性'] || '').trim() : '',
         maxConsecDays: parseSubjectMaxConsecutiveDays(subject),
        isVirtual: String(entry['課堂屬性'] || '') === '抽離',
        isCore: coreSubjects.has(subjectCode),
        isActivity: activitySubjects.has(subjectCode)
      };
    };

    const scorePlacement = (lesson, day, period, baseSchedule, baseLookup = null) => evaluateSlotScoreOnSchedule(lesson, day, period, baseSchedule, false, baseLookup);
    const getTeacherGapCostForEntries = (baseSchedule, entries) => {
      const teacherSet = new Set(entries.flatMap(entry =>
        getAutoTeacherCodes(entry).map(code => canonicalAutoTeacherCode(code)).filter(Boolean)
      ));
      if (teacherSet.size === 0) return 0;
      const periodsByTeacherDay = new Map();
      const addPeriod = (teacherCode, day, period) => {
        if (!teacherSet.has(teacherCode) || day < 1 || day > 5 || period < 1 || period > 7) return;
        const key = teacherCode + '|' + day;
        if (!periodsByTeacherDay.has(key)) periodsByTeacherDay.set(key, new Set());
        periodsByTeacherDay.get(key).add(period);
      };
      baseSchedule.forEach(entry => {
        const day = parseInt(entry['星期'], 10);
        const period = parseInt(entry['節次'], 10);
        getAutoTeacherCodes(entry).forEach(code => addPeriod(canonicalAutoTeacherCode(code), day, period));
      });
      entries.forEach(entry => {
        const day = parseInt(entry['星期'], 10);
        const period = parseInt(entry['節次'], 10);
        getAutoTeacherCodes(entry).forEach(code => addPeriod(canonicalAutoTeacherCode(code), day, period));
      });
      let gaps = 0;
      periodsByTeacherDay.forEach((periods, key) => {
        if (periods.size < 2) return;
        const day = Number(key.slice(key.lastIndexOf('|') + 1));
        const teacherCode = key.slice(0, key.lastIndexOf('|'));
        const sorted = [...periods].sort((left, right) => left - right);
        for (let period = sorted[0] + 1; period < sorted[sorted.length - 1]; period++) {
          if (!periods.has(period) && !idx.blockSet.has(teacherCode + '|' + day + '|' + period)) gaps++;
        }
      });
      return gaps;
    };

    const findBestMove = (index) => {
      if (shouldStopAutoSchedule('local-optimization')) return null;
      const current = localSchedule[index];
      if (!isAutoMovableEntry(current)) return null;
      const oldDay = parseInt(current['星期'], 10);
      const oldPeriod = parseInt(current['節次'], 10);
      const lesson = entryToLesson(current);
      const baseSchedule = localSchedule.filter((_, i) => i !== index);
      const baseLookup = buildScheduleLookup(baseSchedule);
       const oldScore = scorePlacement(lesson, oldDay, oldPeriod, baseSchedule, baseLookup);
       const oldGapCost = getTeacherGapCostForEntries(baseSchedule, [current]);
      const oldRelationViolations = getSubjectRelationViolationCount(lesson, oldDay, oldPeriod, baseSchedule, baseLookup);
      let best = null;

      for (let day = 1; day <= 5; day++) {
        for (let period = autoStartPeriod; period <= autoEndPeriod; period++) {
           if (shouldStopAutoSchedule('local-optimization')) break;
            if (day === oldDay && period === oldPeriod) continue;
           if (!isSlotValid(lesson.classCode, lesson.subjectCode, autoTeacherInput(lesson), day, period, baseSchedule, baseLookup)) continue;
            const relationViolations = getSubjectRelationViolationCount(lesson, day, period, baseSchedule, baseLookup);
            if (relationViolations > oldRelationViolations) continue;
            const score = scorePlacement(lesson, day, period, baseSchedule, baseLookup);
            const delta = score - oldScore;
            const projectedEntry = { ...current, '星期': day, '節次': period };
            const gapDelta = oldGapCost - getTeacherGapCostForEntries(baseSchedule, [projectedEntry]);
             const relationDelta = oldRelationViolations - relationViolations;
             if (gapDelta <= 0 && relationDelta <= 0 && delta <= 0) continue;
             const tieBreak = autoRandomTieBreak();
             const shouldChoose = !best ||
               gapDelta > best.gapDelta ||
               (gapDelta === best.gapDelta && relationDelta > best.relationDelta) ||
               (gapDelta === best.gapDelta && relationDelta === best.relationDelta && delta > best.delta) ||
               (optRandomize && gapDelta === best.gapDelta && relationDelta === best.relationDelta && delta === best.delta && tieBreak > best.tieBreak);
             if (shouldChoose) {
               best = {
                 delta,
                 score,
                 relationDelta,
                 gapDelta,
                 tieBreak,
                 entry: { ...current, '星期': day, '節次': period }
               };
          }
        }
      }
      return best;
    };

    const collectSubjectRelationConflicts = () => {
      const grouped = new Map();
      localSchedule.forEach(entry => {
        if (isPatrolScheduleEntry(entry)) return;
        const classCode = String(entry['班級代碼'] || '').trim();
        const subjectCode = String(entry['科目代碼'] || '').trim();
        const day = parseInt(entry['星期'], 10);
        if (!classCode || !subjectCode || !Number.isFinite(day)) return;
        const key = classCode + '|' + day;
        if (!grouped.has(key)) grouped.set(key, { classCode, day, subjects: new Set(), entries: [] });
        const group = grouped.get(key);
        group.subjects.add(subjectCode);
        group.entries.push(entry);
      });

      const conflicts = [];
      (state.subjectRelations || []).forEach(relation => {
        const pair = getSubjectRelationCodes(relation);
        if (pair.length !== 2) return;
        grouped.forEach(group => {
          const classInfo = idx.classByCode[group.classCode];
          const grade = String(classInfo?.['年級'] || group.classCode.charAt(0)).trim();
          if (!group.subjects.has(pair[0]) || !group.subjects.has(pair[1]) ||
              !subjectRelationAppliesToClass(relation, group.classCode, grade)) return;
          conflicts.push({
            relation,
            classCode: group.classCode,
            day: group.day,
            entries: group.entries.filter(entry => pair.includes(String(entry['科目代碼'] || '').trim()))
          });
        });
      });
      return conflicts;
    };

    const repairSubjectRelationConflicts = () => {
      let moved = 0;
      for (let pass = 0; pass < 2; pass++) {
        if (shouldStopAutoSchedule('subject-relation-optimization')) break;
        const conflicts = collectSubjectRelationConflicts();
        if (conflicts.length === 0) break;
        let passMoved = 0;
        conflicts.forEach(conflict => {
          if (!conflict.entries.every(entry =>
            localSchedule.includes(entry) && parseInt(entry['星期'], 10) === conflict.day
          )) return;
          const movableEntries = conflict.entries.filter(entry => isAutoMovableEntry(entry));
          let best = null;
          movableEntries.forEach(entry => {
            if (shouldStopAutoSchedule('subject-relation-optimization')) return;
            const index = localSchedule.indexOf(entry);
            if (index < 0) return;
            const lesson = entryToLesson(entry);
            const baseSchedule = localSchedule.filter((_, itemIndex) => itemIndex !== index);
            const baseLookup = buildScheduleLookup(baseSchedule);
            for (let day = 1; day <= 5; day++) {
              for (let period = autoStartPeriod; period <= autoEndPeriod; period++) {
                if (shouldStopAutoSchedule('subject-relation-optimization')) break;
                if (day === conflict.day) continue;
                if (!isSlotValid(lesson.classCode, lesson.subjectCode, autoTeacherInput(lesson), day, period, baseSchedule, baseLookup)) continue;
                if (getSubjectRelationViolationCount(lesson, day, period, baseSchedule, baseLookup) > 0) continue;
                const score = scorePlacement(lesson, day, period, baseSchedule, baseLookup);
                if (!best || score > best.score) best = { index, entry, day, period, score };
              }
            }
          });
          if (!best) return;
          setLocalScheduleEntry(best.index, { ...best.entry, '星期': best.day, '節次': best.period });
          passMoved++;
          moved++;
        });
        if (passMoved === 0) break;
      }
      return moved;
    };

    const getMovableIndexes = () => localSchedule
      .map((entry, index) => isAutoMovableEntry(entry) ? index : -1)
      .filter(index => index >= 0);

    localOptimizationCandidates = getMovableIndexes().length;
    if (localOptimizationCandidates === 0) return;
    updateProgress('正在改善合法但不理想的課表…');

    for (let pass = 0; pass < localOptPasses; pass++) {
      if (shouldStopAutoSchedule('local-optimization')) break;
      const passScheduleSnapshot = [...localSchedule];
      const passQualityBefore = readLocalQuality(passScheduleSnapshot);
      let passMoves = 0;
      let improved = false;
      for (const index of getMovableIndexes()) {
        if (shouldStopAutoSchedule('local-optimization')) break;
        const best = findBestMove(index);
        if (!best) continue;
        setLocalScheduleEntry(index, best.entry);
        localOptimizationAttemptedMoves++;
        localOptimizationMoves++;
        passMoves++;
        improved = true;
      }

      // 沒有空格可直接移動時，再嘗試交換兩個可移動課程的時段。
      if (optSmartSwap) {
        const trySwapPair = (indexA, indexB) => {
          const entryA = localSchedule[indexA];
          const entryB = localSchedule[indexB];
          if (!entryA || !entryB) return false;
          const dayA = parseInt(entryA['星期'], 10);
          const periodA = parseInt(entryA['節次'], 10);
          const dayB = parseInt(entryB['星期'], 10);
          const periodB = parseInt(entryB['節次'], 10);
          if (dayA === dayB && periodA === periodB) return false;

          const baseSchedule = localSchedule.filter((_, i) => i !== indexA && i !== indexB);
          const baseLookup = buildScheduleLookup(baseSchedule);
          const lessonA = entryToLesson(entryA);
          const lessonB = entryToLesson(entryB);
          if (!isSlotValid(lessonA.classCode, lessonA.subjectCode, autoTeacherInput(lessonA), dayB, periodB, baseSchedule, baseLookup)) return false;

          const movedA = { ...entryA, '星期': dayB, '節次': periodB };
          const scheduleWithA = [...baseSchedule, movedA];
          const lookupWithA = buildScheduleLookup(scheduleWithA);
          if (!isSlotValid(lessonB.classCode, lessonB.subjectCode, autoTeacherInput(lessonB), dayA, periodA, scheduleWithA, lookupWithA)) return false;

          const oldScheduleWithA = [...baseSchedule, entryA];
          const oldLookupWithA = buildScheduleLookup(oldScheduleWithA);
          const oldScore = scorePlacement(lessonA, dayA, periodA, baseSchedule, baseLookup) +
            scorePlacement(lessonB, dayB, periodB, oldScheduleWithA, oldLookupWithA);
           const newScore = scorePlacement(lessonA, dayB, periodB, baseSchedule, baseLookup) +
             scorePlacement(lessonB, dayA, periodA, scheduleWithA, lookupWithA);
           const oldGapCost = getTeacherGapCostForEntries(baseSchedule, [entryA, entryB]);
           const movedB = { ...entryB, '星期': dayA, '節次': periodA };
           const newGapCost = getTeacherGapCostForEntries(baseSchedule, [movedA, movedB]);
           const oldRelationCost = getSubjectRelationViolationCount(lessonA, dayA, periodA, baseSchedule, baseLookup) +
             getSubjectRelationViolationCount(lessonB, dayB, periodB, oldScheduleWithA, oldLookupWithA);
           const newRelationCost = getSubjectRelationViolationCount(lessonA, dayB, periodB, baseSchedule, baseLookup) +
             getSubjectRelationViolationCount(lessonB, dayA, periodA, scheduleWithA, lookupWithA);
           if (newRelationCost > oldRelationCost ||
               newGapCost > oldGapCost ||
               (newGapCost === oldGapCost && newRelationCost === oldRelationCost && newScore <= oldScore)) return false;

          setLocalScheduleEntry(indexA, movedA);
          setLocalScheduleEntry(indexB, movedB);
          return true;
        };

        const movableIndexes = getMovableIndexes();
        let checkedPairs = 0;
        const classGroups = new Map();
        movableIndexes.forEach(index => {
          const classCode = String(localSchedule[index]['班級代碼'] || '');
          if (!classGroups.has(classCode)) classGroups.set(classCode, []);
          classGroups.get(classCode).push(index);
        });
        const prioritizedGroups = [...classGroups.values()].sort((left, right) =>
          getTeacherGapCostForEntries(localSchedule, right.map(index => localSchedule[index])) -
          getTeacherGapCostForEntries(localSchedule, left.map(index => localSchedule[index]))
        );
        swapSearch: for (const group of prioritizedGroups) {
          if (shouldStopAutoSchedule('local-optimization')) break swapSearch;
          for (let a = 0; a < group.length; a++) {
            for (let b = a + 1; b < group.length; b++) {
              if (shouldStopAutoSchedule('local-optimization')) break swapSearch;
              if (++checkedPairs > maxSwapPairsPerPass) break swapSearch;
              if (!trySwapPair(group[a], group[b])) continue;
              localOptimizationAttemptedMoves++;
              localOptimizationMoves++;
              passMoves++;
              improved = true;
              break swapSearch;
            }
          }
        }
        if (!improved) {
          checkedPairs = 0;
          swapSearch: for (let a = 0; a < movableIndexes.length; a++) {
            if (shouldStopAutoSchedule('local-optimization')) break swapSearch;
            for (let b = a + 1; b < movableIndexes.length; b++) {
              if (shouldStopAutoSchedule('local-optimization')) break swapSearch;
              if (++checkedPairs > maxSwapPairsPerPass) break swapSearch;
              if (!trySwapPair(movableIndexes[a], movableIndexes[b])) continue;
              localOptimizationAttemptedMoves++;
              localOptimizationMoves++;
              passMoves++;
              improved = true;
              break swapSearch;
            }
          }
        }
      }

      const relationMoves = repairSubjectRelationConflicts();
      if (relationMoves > 0) {
        localOptimizationMoves += relationMoves;
        passMoves += relationMoves;
        improved = true;
      }

      const passQualityAfter = readLocalQuality(localSchedule);
      if (passQualityBefore && passQualityAfter && compareLocalQuality(passQualityAfter, passQualityBefore) > 0) {
        replaceLocalSchedule(passScheduleSnapshot);
        localOptimizationMoves -= passMoves;
        localOptimizationRollbacks++;
        improved = false;
        console.log('  ↩️ 局部最佳化品質未改善，回復本輪移動');
      }

      if (!improved) break;
      await yieldToUI();
    }
    console.log('[AutoSchedule] 局部最佳化完成：' + localOptimizationMoves + ' 次移動／交換');
  }

  await optimizeAutoScheduleLocally();

  markAutoScheduleProfile('diagnostics');
  function analyzeAutoFailureLesson(lesson) {
    const teacherIdentities = new Set(resolveAutoTeacherCodes(autoTeacherInput(lesson)));
    const exclusivePeers = new Set();
    teacherIdentities.forEach(identity => (autoTeacherExclusivePeers.get(identity) || []).forEach(peer => exclusivePeers.add(peer)));
    const subjectCode = String(lesson.subjectCode || '');
    const roomCode = getSubjectRoomCode(subjectCode);
    const subject = idx.subjectByCode[subjectCode] || {};
    const maxConcurrent = parseInt(subject['同時最多班數'] || '0', 10) || 0;
    const rules = getApplicableRules(subjectCode, lesson.classCode);
    const blockerCounts = new Map();
    const slots = [];
    const failureLookup = buildScheduleLookup(localSchedule);
    const movableEntries = new Set();
    let candidateSlots = 0;
    let legalSlots = 0;
    const addBlocker = (blockers, type, entry = null) => {
      blockers.push(type);
      blockerCounts.set(type, (blockerCounts.get(type) || 0) + 1);
      if (entry && !isFrozenAutoEntry(entry) && !isBindAutoEntry(entry)) {
        const key = String(entry['課表ID'] || [entry['班級代碼'], entry['科目代碼'], entry['星期'], entry['節次']].join('|'));
        movableEntries.add(key);
      }
    };

    for (let day = 1; day <= 5; day++) {
      for (let period = autoStartPeriod; period <= autoEndPeriod; period++) {
        candidateSlots++;
        const slotEntries = localSchedule.filter(entry =>
          parseInt(entry['星期'], 10) === day && parseInt(entry['節次'], 10) === period
        );
        const blockers = [];
        slotEntries
          .filter(entry => String(entry['班級代碼']) === String(lesson.classCode))
          .forEach(entry => addBlocker(blockers, '班級格已占用', entry));
        teacherIdentities.forEach(identity => {
          if (idx.blockSet.has(identity + '|' + day + '|' + period)) addBlocker(blockers, '教師不排課');
          slotEntries
            .filter(entry => resolveAutoTeacherCodes(entry).includes(identity))
            .forEach(entry => addBlocker(blockers, '教師衝堂', entry));
        });
        slotEntries
          .filter(entry => resolveAutoTeacherCodes(entry).some(identity => exclusivePeers.has(identity)))
          .forEach(entry => addBlocker(blockers, '教師互斥', entry));
        if (roomCode) {
          const roomEntries = slotEntries.filter(entry => !isPatrolScheduleEntry(entry) && getSubjectRoomCode(entry['科目代碼']) === roomCode);
          if (roomEntries.length >= getSubjectRoomCapacity(subjectCode)) roomEntries.forEach(entry => addBlocker(blockers, '教室容量', entry));
        }
        if (maxConcurrent > 0) {
          slotEntries
            .filter(entry => String(entry['科目代碼']) === subjectCode)
            .slice(0, Math.max(0, slotEntries.filter(entry => String(entry['科目代碼']) === subjectCode).length - maxConcurrent + 1))
            .forEach(entry => addBlocker(blockers, '科目同時上限', entry));
        }
        if (rules.some(item => isForbiddenAutoRule(item.rule) && item.slots.some(slot => slot.day === day && slot.period === period))) {
          addBlocker(blockers, '科目禁排');
        }
        const mandatoryRules = rules.filter(item => isMandatoryAutoRule(item.rule));
        if (mandatoryRules.length > 0 && !mandatoryRules.some(item => item.slots.some(slot => slot.day === day && slot.period === period))) {
          addBlocker(blockers, '不在必排時段');
        }
        if (!canPlaceClassSubjectOnDay(lesson.classCode, subjectCode, day, localSchedule, failureLookup)) {
          addBlocker(blockers, '同班同科同日限制');
        }
        if (!canPlaceSubjectWithinMaxConsecutiveDays(lesson.classCode, subjectCode, day, localSchedule, failureLookup)) {
          addBlocker(blockers, '科目連日限制');
        }
        if (optTeacherConsec) {
          teacherIdentities.forEach(identity => {
            const teacher = idx.teacherByCode[canonicalAutoTeacherCode(identity)];
            const maxConsecutive = teacher ? parseInt(teacher['最大連堂節數'] || '2', 10) : 2;
            if (countConsecutiveInLocal(localSchedule, identity, day, period) > maxConsecutive) addBlocker(blockers, '教師連堂限制');
          });
        }
        if (isSlotValid(lesson.classCode, subjectCode, autoTeacherInput(lesson), day, period, localSchedule, failureLookup)) {
          legalSlots++;
        } else if (blockers.length === 0) {
          addBlocker(blockers, '其他硬限制');
        }
        if (blockers.length > 0) slots.push({ day, period, blockers: [...new Set(blockers)] });
      }
    }
    slots.sort((left, right) => left.blockers.length - right.blockers.length || left.day - right.day || left.period - right.period);
    return {
      candidateSlots,
      legalSlots,
      minimumBlockerTypes: slots[0]?.blockers.length || 0,
      movableEntries: movableEntries.size,
      blockerCounts: Object.fromEntries([...blockerCounts.entries()].sort((left, right) => right[1] - left[1])),
      tightSlots: slots.slice(0, 5)
    };
  }

  const includeFailureGraph = runOptions.includeFailureGraph === true ||
    (previewOnly && typeof window !== 'undefined' && window.__enableAutoFailureGraph === true);
  const autoFailureDetails = [...failList, ...bindFailureLessons]
    .filter(Boolean)
    .map(lesson => ({
      classCode: String(lesson.classCode || ''),
      subjectCode: String(lesson.subjectCode || ''),
      teacherCode: String(lesson.teacherCode || ''),
      failureReason: String(lesson.failureReason || ''),
      dynamicPressure: Number(lesson.dynamicPressure || getAutoConflictPressure(lesson)),
      strictAvailableSlots: Number(lesson.strictAvailableSlots || 0),
      sameDayRelaxedAvailableSlots: Number(lesson.sameDayRelaxedAvailableSlots || 0),
      constraintGraph: includeFailureGraph ? analyzeAutoFailureLesson(lesson) : null
    }));
  const conflictPressureSnapshot = {
    failureEvents: autoConflictStats.failureEvents,
    classes: Object.fromEntries(autoConflictWeights.class),
    teachers: Object.fromEntries(autoConflictWeights.teacher),
    subjects: Object.fromEntries(autoConflictWeights.subject),
    rooms: Object.fromEntries(autoConflictWeights.room),
    reasons: Object.fromEntries(autoConflictWeights.reason)
  };
  const runSummarySnapshot = {
    timedOut: autoScheduleTimedOut,
    timeBudgetMs: autoScheduleTimeBudgetMs,
    repairBudgetExceeded,
    repairOperationCount,
    repairOperationLimit,
    repairGlobalReserveMs,
    neighborhoodRepairMoves,
    globalMatchingPasses,
    neighborhoodRepairStats,
    conflictGraphMoves,
    conflictGraphSearches: conflictGraphStats.searches,
    conflictGraphNodes: conflictGraphStats.nodes,
    conflictGraphCandidates: conflictGraphStats.candidates,
    bindFailureDiagnostics: [...bindFailureDiagnostics.values()],
    localOptimizationMoves,
    localOptimizationCandidates,
    localOptimizationAttemptedMoves,
    localOptimizationRollbacks,
    qualityGraceActive: autoScheduleQualityGraceActive,
    failureCount: failList.length + bindFailureLessons.length
  };
  const runProfileSnapshot = readAutoScheduleProfile();

  // 4. 完成
  await yieldToUI();
  updateProgress('整理排課結果中…');
  await yieldToUI();

  // 5. 凍結課與硬限制品質驗證（純邏輯，不含 UI 操作）
  const frozenViolations = verifyFrozenEntries();
  if (frozenViolations.length > 0) {
    console.error('[AutoSchedule] 凍結課完整性檢查失敗：', frozenViolations);
    const failedResult = {
      schedule: localSchedule.map(entry => ({ ...entry })),
      quality: null,
      frozenViolations,
      pendingCount: pendingLessons.length,
      localOptimizationMoves,
      neighborhoodRepairMoves,
      conflictGraphMoves,
      timedOut: autoScheduleTimedOut,
      timeBudgetMs: autoScheduleTimeBudgetMs,
      repairBudgetExceeded,
      failureDetails: autoFailureDetails,
      failList: failList.map(l => ({ id: l.id, classCode: l.classCode, subjectCode: l.subjectCode, teacherCode: l.teacherCode, failureReason: l.failureReason })),
      bindFailureLessons: bindFailureLessons.map(l => ({ id: l.id, classCode: l.classCode, subjectCode: l.subjectCode, teacherCode: l.teacherCode, failureReason: l.failureReason })),
      bindDefinitionErrors: [...bindDefinitionErrors],
      originalScheduleIds: [...originalScheduleIds],
      autoStartPeriod,
      autoEndPeriod,
      optP8Only,
      optOnePerDay,
      elapsedMs: Date.now() - autoScheduleStartedAt,
      profile: runProfileSnapshot,
      conflictPressure: conflictPressureSnapshot,
      runSummary: runSummarySnapshot
    };
    if (skipUiCommit || typeof applySingleAutoScheduleResultUi !== 'function') return failedResult;
    return applySingleAutoScheduleResultUi(failedResult);
  }

  const auditFnFinal = typeof buildAutoScheduleQualityReport === 'function'
    ? buildAutoScheduleQualityReport
    : (typeof window !== 'undefined' && typeof window.buildAutoScheduleQualityReport === 'function' ? window.buildAutoScheduleQualityReport : null);
  const candidateQuality = auditFnFinal
    ? auditFnFinal({ schedule: localSchedule, optP8Only, autoEndPeriod, onePerDay: optOnePerDay, ignoreTeacherConsecutiveIds: originalScheduleIds })
    : null;
  if (candidateQuality && candidateQuality.violations.length > 0) {
    console.error('[AutoSchedule] 候選課表硬限制稽核失敗：', candidateQuality.violations);
  }
  const finalResult = {
    schedule: localSchedule.map(entry => ({ ...entry })),
    quality: candidateQuality,
    pendingCount: pendingLessons.length,
    localOptimizationMoves,
    neighborhoodRepairMoves,
    conflictGraphMoves,
    timedOut: autoScheduleTimedOut,
    timeBudgetMs: autoScheduleTimeBudgetMs,
    repairBudgetExceeded,
    failureDetails: autoFailureDetails,
    failList: failList.map(l => ({ id: l.id, classCode: l.classCode, subjectCode: l.subjectCode, teacherCode: l.teacherCode, failureReason: l.failureReason })),
    bindFailureLessons: bindFailureLessons.map(l => ({ id: l.id, classCode: l.classCode, subjectCode: l.subjectCode, teacherCode: l.teacherCode, failureReason: l.failureReason })),
    bindDefinitionErrors: [...bindDefinitionErrors],
    originalScheduleIds: [...originalScheduleIds],
    autoStartPeriod,
    autoEndPeriod,
    optP8Only,
    optOnePerDay,
    elapsedMs: Date.now() - autoScheduleStartedAt,
    profile: runProfileSnapshot,
    conflictPressure: conflictPressureSnapshot,
    runSummary: runSummarySnapshot
  };
  if (skipUiCommit || typeof applySingleAutoScheduleResultUi !== 'function') return finalResult;
  return applySingleAutoScheduleResultUi(finalResult);
}

function compareAutoScheduleResults(left, right) {
  const leftQuality = left?.quality || {};
  const rightQuality = right?.quality || {};
  const leftViolations = Array.isArray(leftQuality.violations) ? leftQuality.violations : [];
  const rightViolations = Array.isArray(rightQuality.violations) ? rightQuality.violations : [];
  if (leftViolations.length !== rightViolations.length) return leftViolations.length - rightViolations.length;
  const leftRemaining = Number(leftQuality.remainingLessons) || 0;
  const rightRemaining = Number(rightQuality.remainingLessons) || 0;
  if (leftRemaining !== rightRemaining) return leftRemaining - rightRemaining;
  const leftBindViolations = leftViolations.filter(item => String(item).includes('綁班')).length;
  const rightBindViolations = rightViolations.filter(item => String(item).includes('綁班')).length;
  if (leftBindViolations !== rightBindViolations) return leftBindViolations - rightBindViolations;
  for (const metric of [
    'teacherGaps',
    'teacherImbalance',
    'subjectRelationSoftViolations',
    'teacherLongStreaks',
    'teacherRepeatedPeriods',
    'teacherAfternoonOverload',
    'teacherCrossGradeSameDay',
    'teacherCrossGradeAdjacent'
  ]) {
    const leftValue = Number(leftQuality[metric]) || 0;
    const rightValue = Number(rightQuality[metric]) || 0;
    if (leftValue !== rightValue) return leftValue - rightValue;
  }
  return (Number(rightQuality.score) || 0) - (Number(leftQuality.score) || 0);
}

async function runPureAutoSchedule(snapshot, runOptions = {}) {
  if (snapshot && typeof snapshot === 'object') {
    state.classes = snapshot.classes || [];
    state.teachers = snapshot.teachers || [];
    state.subjects = snapshot.subjects || [];
    state.assignments = snapshot.assignments || [];
    state.schedule = (snapshot.schedule || []).map(entry => ({ ...entry }));
    state.scheduleRevision = String(snapshot.scheduleRevision || '');
    state.teacherBlocks = snapshot.teacherBlocks || [];
    state.subjectRules = snapshot.subjectRules || [];
    state.subjectRelations = snapshot.subjectRelations || [];
    state.blockGroups = snapshot.blockGroups || [];
    state.rooms = snapshot.rooms || [];
    state.scheduleColors = snapshot.scheduleColors || [];
    state.teacherExclusives = snapshot.teacherExclusives || [];
    state.settings = snapshot.settings || {};
    buildIndex();
  }
  return executeAutoScheduleCore({
    ...runOptions,
    previewOnly: true,
    skipUiCommit: true,
    skipPreflight: true
  });
}
