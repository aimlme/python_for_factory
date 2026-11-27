/* Thai / English switch.
   The UI is written in Thai; in English mode every Thai text node, tooltip, placeholder and
   aria-label is translated as it appears (MutationObserver). Only WHOLE text nodes are matched,
   so user data (project / class names in Thai) is never partly replaced.
   Missing translations are collected in window.__i18nMissing (check in the browser console). */
'use strict';
const LANG = () => localStorage.getItem('vt_lang') === 'en' ? 'en' : 'th';
const LOC = () => LANG() === 'en' ? 'en-GB' : 'th-TH';
const THAI = /[฀-๿]/;

const I18N_EXACT = {
  // nav / shell
  'โปรเจกต์': 'Project', 'เก็บภาพ': 'Capture', 'เทรน': 'Train', 'ผลลัพธ์': 'Results', 'หน้าจอไลน์': 'Line screen',
  'ขั้นตอน': 'Steps', 'กล้อง': 'Camera', 'เชื่อมต่อ server ไม่ได้': 'Cannot reach the server', 'กำลังโหลด…': 'Loading…',
  'เกิดข้อผิดพลาด': 'Something went wrong', '— ยังไม่มีโปรเจกต์ —': '— no project yet —',
  'กำลังเริ่ม': 'Starting', 'กำลังเตรียมข้อมูล': 'Preparing data', 'กำลังเทรน': 'Training', 'กำลังวัดผล': 'Evaluating',
  'กำลังแปลงไฟล์ ONNX': 'Exporting ONNX', 'เสร็จแล้ว': 'Done',
  // project
  '1 โปรเจกต์ = 1 จุดตรวจ (สถานี + กล้อง + ชุด class) — ไม่ควรเกิน 3–5 class ต่อโมเดล': '1 project = 1 inspection point (station + camera + set of classes) — keep it to 3–5 classes per model',
  'เลือกโปรเจกต์': 'Choose a project', 'ยังไม่ deploy': 'not deployed', 'กำลังใช้': 'In use', 'เลือก': 'Select',
  'ยังไม่มีโปรเจกต์ — สร้างโปรเจกต์แรกทางขวา': 'No projects yet — create the first one on the right',
  'สร้างโปรเจกต์ใหม่': 'New project', 'ชื่อ': 'Name', 'เช่น ตรวจรอยแตก': 'e.g. Crack check', 'สถานี / กล้อง': 'Station / camera',
  'เช่น ST-07': 'e.g. ST-07', 'ประเภทตำหนิ (1 บรรทัดต่อ 1 class, ใช้ชื่อเดียวกับใน settings.json → defect_codes)': 'Defect types (one class per line, same names as settings.json → defect_codes)',
  'สร้างและเริ่มเก็บภาพ': 'Create and start capturing', 'แก้ไขโปรเจกต์ปัจจุบัน': 'Edit current project', 'สถานี': 'Station',
  'Class (เพิ่มต่อท้ายได้ ห้ามลบ/สลับเมื่อ label แล้ว)': 'Classes (you can append; no deleting/reordering once labeled)',
  'บันทึก': 'Save', 'บันทึกแล้ว': 'Saved', 'โปรเจกต์ใหม่': 'New project',
  // capture
  'เก็บภาพจากไลน์': 'Capture images from the line', 'ถ่ายเอง, ให้ระบบเก็บทุกครั้งที่ PLC ส่ง trigger, หรืออัปโหลดภาพที่มีอยู่แล้ว': 'Shoot by hand, save on every PLC trigger, or upload existing images',
  'ไป Label →': 'Go to Label →', 'กล้องสด': 'Live camera', 'ภาพสดจากกล้อง': 'Live camera image', 'กำลังเชื่อมต่อกล้อง…': 'Connecting to camera…',
  'ถ่ายภาพ': 'Capture', 'เก็บอัตโนมัติทุก trigger จาก PLC': 'Save automatically on every PLC trigger', 'เปิดกล้องใหม่': 'Restart camera',
  'อัปโหลดภาพ': 'Upload images', 'ลากไฟล์ภาพมาวางที่นี่ หรือ': 'Drop image files here, or', 'เลือกไฟล์': 'choose files',
  'ข้ามไฟล์ที่เคยอัปโหลดแล้ว': 'Skip files already uploaded', 'ภาพล่าสุด': 'Latest images', 'ดูทั้งหมด': 'View all',
  'ภาพที่ต้องเก็บ (label แล้ว)': 'Images needed (labeled)', 'ควรแก้ก่อนเทรน': 'Fix before training', 'label แล้ว · OK': 'labeled · OK',
  'รอตรวจ': 'To review', 'ยังไม่ label': 'Not labeled', 'ยังไม่มีภาพ': 'No images yet', 'ยังไม่เปิด': 'not started',
  'เฟรมเดิม — ยังไม่ได้บันทึก': 'Same frame — not saved', 'บันทึกภาพแล้ว': 'Image saved', 'เปิดเก็บอัตโนมัติแล้ว': 'Auto-capture on',
  'ปิดเก็บอัตโนมัติ': 'Auto-capture off', 'ชิ้นงานดี (ไม่มีกรอบ)': 'Good parts (no boxes)',
  // label
  'Class': 'Class', 'เครื่องมือ': 'Tools', 'ลากกรอบเอง': 'Draw box', 'คลิกจุดเดียว (AI ตีกรอบ)': 'One click (AI draws box)',
  'คัดลอกกรอบจากภาพก่อน': 'Copy boxes from previous', 'ภาพนี้ไม่มีตำหนิ (OK)': 'No defect in this image (OK)', 'ลบภาพนี้': 'Delete image',
  'ภาพที่กำลัง label': 'Image being labeled', 'แสดง': 'Show', 'ทั้งหมด': 'All', 'label แล้ว': 'Labeled', 'ภาพก่อนหน้า': 'Previous image',
  'ภาพถัดไป': 'Next image', 'label แล้วทั้งโปรเจกต์': 'Labeled in project', 'กรอบในภาพนี้': 'Boxes in this image',
  'ยอมรับทั้งหมด': 'Accept all', 'ให้ AI เสนอกรอบ': 'Ask AI for boxes', 'คีย์ลัด': 'Shortcuts',
  'เปลี่ยน class / class ของกรอบที่เลือก': 'Class / class of selected box', 'ยอมรับกรอบ AI': 'Accept AI box',
  'ยอมรับกรอบ AI ทั้งหมด': 'Accept all AI boxes', 'ปฏิเสธกรอบ AI': 'Reject AI box', 'ลบกรอบที่เลือก': 'Delete selected box',
  'ย้อนกลับ': 'Undo', 'ภาพก่อน / ถัดไป': 'Previous / next image', 'ไปเทรน →': 'Go to Train →',
  '— เสนอกรอบ (เส้นประ) ให้ภาพที่ยังไม่มีกรอบ กดยอมรับหรือแก้': '— suggests boxes (dashed) on images without boxes; accept or fix them',
  'เสนอกรอบอัตโนมัติ': 'Suggest boxes automatically', 'ยังไม่มีโมเดลช่วย label': 'No labeling helper model yet',
  '— label ประมาณ 30 ภาพแล้ว': '— label about 30 images, then', 'เทรนโหมดเร็ว': 'train in Fast mode', 'ระบบจะเริ่มเสนอกรอบให้ภาพที่เหลือ': 'and the system will start suggesting boxes for the rest',
  'ไม่มีภาพในรายการนี้': 'No images in this list', 'label ครบแล้ว 🎉 — ไปเทรนได้เลย': 'All labeled 🎉 — ready to train',
  'AI ไม่พบตำหนิในภาพนี้': 'AI found no defect in this image', 'OK — ไม่มีตำหนิ': 'OK — no defect', 'ยืนยันแล้ว': 'Confirmed',
  'รอยืนยัน': 'Pending', 'ภาพนี้ถูกบันทึกเป็นชิ้นงานดี': 'Saved as a good part', 'ยังไม่มีกรอบ — ลากกรอบ หรือกด 0 ถ้าไม่มีตำหนิ': 'No boxes yet — draw one, or press 0 if there is no defect',
  'OK ไม่มีตำหนิ': 'OK no defect', 'AI กำลังหาขอบเขต…': 'AI is finding the outline…', 'หาขอบเขตไม่เจอ — ลองคลิกกลางรอย หรือใช้ลากกรอบ': 'No outline found — click the middle of the mark, or draw a box',
  'ไม่มีภาพก่อนหน้า': 'No previous image', 'ภาพก่อนหน้าไม่มีกรอบ': 'Previous image has no boxes', 'ลบภาพนี้ออกจากโปรเจกต์?': 'Delete this image from the project?',
  // train
  'เทรนโมเดล': 'Train a model', 'เลือกแค่ว่าต้องการเร็วหรือแม่น — ที่เหลือระบบตั้งให้': 'Just choose fast or accurate — the rest is set for you',
  'โหมดการเทรน': 'Training mode', 'เร็ว': 'Fast', 'แม่นยำ': 'Accurate', 'ตั้งค่าขั้นสูง (สำหรับวิศวกร)': 'Advanced settings (engineers)',
  'เว้นว่าง = ใช้ค่าของ preset · base model ที่วางไว้ในโฟลเดอร์ models/ จะใช้แทนการดาวน์โหลด': 'Blank = preset value · a base model placed in models/ is used instead of downloading',
  'ตรวจก่อนเทรน': 'Pre-training checks', 'เริ่มเทรน': 'Start training', 'ประวัติการเทรน': 'Training history', 'เริ่มเทรนแล้ว': 'Training started',
  'โหมดเร็ว': 'Fast mode', 'โหมดแม่นยำ': 'Accurate mode', 'ปิด cuDNN': 'cuDNN off', 'เหลือประมาณ': 'about',
  'ความแม่น (mAP50) บนชุดทดสอบ — ยิ่งสูงยิ่งดี': 'Accuracy (mAP50) on the test set — higher is better', 'กราฟความแม่นต่อรอบ': 'Accuracy per epoch chart',
  'ระบบจะ': 'Training', 'หยุดเอง': 'stops by itself', 'เมื่อความแม่นไม่ดีขึ้นแล้ว — ปิดหน้านี้ได้ งานยังเดินต่อ': 'when accuracy stops improving — you can close this page, the job keeps running',
  'ยกเลิก': 'Cancel', 'ยกเลิกการเทรนนี้?': 'Cancel this training?', 'ยกเลิกแล้ว': 'Cancelled', 'เครื่องกำลังเทรนโปรเจกต์อื่น': 'Another project is training',
  'เทรนเสร็จแล้ว': 'Training finished', 'ยังไม่เคยเทรน': 'Not trained yet', 'กดเริ่มเทรนเมื่อพร้อม': 'Press Start training when ready',
  'ดูผลลัพธ์ →': 'View results →', 'ถูกยกเลิก': 'cancelled', 'ไม่สำเร็จ': 'Failed', 'เวอร์ชัน': 'Version', 'เมื่อ': 'When', 'โหมด': 'Mode',
  'ภาพ': 'Images', 'สถานะ': 'Status', 'หลุด / แจ้งผิด': 'Missed / false alarm', 'เสร็จ': 'Done', 'ดูผล': 'Results', 'รอบ': 'Epoch',
  // results
  'ยังไม่มีโมเดลที่เทรนเสร็จ —': 'No finished model yet —', 'ไปเทรน': 'go train', 'เลือกเวอร์ชัน': 'Choose version',
  '— ภาพทดสอบน้อย ตัวเลขยังแกว่งได้มาก': '— few test images, numbers can swing a lot', 'เทรนใหม่ด้วยภาพที่แก้': 'Retrain with fixed images',
  'ไป Deploy →': 'Go to Deploy →', 'หลุด (มีตำหนิแต่ปล่อยผ่าน)': 'Missed (defect passed)', 'แจ้งผิด (ชิ้นดีแต่ถูก reject)': 'False alarm (good part rejected)',
  'ตัดสินถูก': 'Correct', 'ปรับความเข้มงวด': 'Strictness', 'histogram คะแนนตำหนิของชิ้นดีและชิ้นมีตำหนิ': 'Histogram of defect scores for good and defective parts',
  'คะแนนตำหนิต่ำ': 'Low defect score', 'คะแนนตำหนิสูง': 'High defect score',
  'เลื่อนซ้าย = เข้มงวด (หลุดน้อย แจ้งผิดมาก) · เลื่อนขวา = ผ่อน': 'Left = strict (fewer misses, more false alarms) · Right = lenient',
  'ชิ้นดี': 'Good', 'มีตำหนิ': 'Defective', 'จับได้แยกตามประเภท': 'Caught per defect type', 'ตัวเลขสำหรับวิศวกร': 'Numbers for engineers',
  'ดาวน์โหลด .pt': 'Download .pt', 'ภาพที่โมเดลตัดสินผิด — กดเพื่อแก้ label': 'Images the model got wrong — click to fix the label',
  'label ผิดก็แก้ได้ แล้วกด "เทรนใหม่"': 'Fix wrong labels too, then press "Retrain"', 'หลุด': 'Missed', 'แจ้งผิด': 'False alarm',
  'ภาพทดสอบน้อย': 'few test images', 'ไม่มีภาพทดสอบ': 'no test images', 'ไม่มีภาพที่ตัดสินผิดที่ threshold นี้': 'No wrong decisions at this threshold',
  '(มีผลกับไลน์ทันที)': '(applies to the line immediately)',
  // deploy
  'Deploy และดูแลต่อเนื่อง': 'Deploy and maintain', 'ทดลองคู่ของเดิมก่อน (shadow) อนุมัติเมื่อมั่นใจ ย้อนกลับได้ในคลิกเดียว': 'Run beside the current model first (shadow), approve when confident, roll back in one click',
  'ให้ไลน์ใช้โปรเจกต์นี้ (รับ trigger จาก PLC)': 'Use this project on the line (take PLC triggers)', 'เปิดหน้าจอไลน์ →': 'Open line screen →',
  'เวอร์ชันโมเดล': 'Model versions', '(ยังไม่มีตัวใช้งานจริง)': '(no live model yet)', 'ยังไม่สั่ง reject จริง': 'not rejecting yet',
  'ระยะเวลา': 'Duration', 'ชิ้นที่ผ่าน': 'Parts seen', 'ผลไม่ตรงกัน': 'Disagreements',
  'ยังไม่มีตัวใช้งานจริงให้เทียบ — ผลของ shadow ถูกบันทึกอย่างเดียว PLC จะไม่ได้รับผล': 'No live model to compare — shadow results are only logged, the PLC gets nothing',
  'หยุด shadow': 'Stop shadow', 'ยังไม่ได้ deploy': 'Not deployed', 'เลือกเวอร์ชันด้านล่าง': 'Choose a version below',
  'ทดสอบคู่ (shadow)': 'Shadow test', 'ตรวจ 24 ชม.': 'Inspected 24 h', 'เวลาเฉลี่ย': 'Avg time', 'เชื่อมต่อไลน์': 'Line connection',
  'ไม่ทำงาน': 'not running', 'รับ trigger': 'Trigger in', 'ส่งผลไป PLC': 'Results to PLC', 'รหัส NG': 'NG codes', 'trigger ที่ได้รับ': 'Triggers received',
  'ส่งล่าสุด': 'Last sent', 'ทดสอบ trigger': 'Test trigger', 'ไม่มีโมเดล deploy หรือไลน์ไม่ได้ใช้โปรเจกต์นี้': 'No deployed model, or the line is not using this project',
  'กล้องไม่ส่งภาพ — ส่ง ER01': 'Camera gave no image — sent ER01', 'ไม่ส่ง PLC': 'not sent to PLC', 'เทรนเมื่อ': 'Trained',
  'หลุด / แจ้งผิด (ทดสอบ)': 'Missed / false alarm (test)', 'การทำงาน': 'Actions', 'ใช้งานจริง': 'Live', 'เก็บไว้': 'Archived',
  'ยังไม่ใช้': 'Unused', 'Rollback ไปเวอร์ชันนี้': 'Roll back to this version', 'ใช้งานจริงทันที': 'Go live now', 'ยังไม่มีโมเดล —': 'No model yet —',
  'ไม่มีภาพรอตรวจ': 'Nothing to review', 'ส่งไปหน้า Label แล้ว': 'Sent to Label', 'บันทึกเป็นชิ้นดี': 'Saved as good part',
  'ครบตามกำหนด — เริ่มเทรนรอบใหม่อัตโนมัติ': 'Target reached — automatic retraining started', 'ชิ้นที่ live กับ shadow ตัดสินต่างกัน': 'Parts where live and shadow disagree',
  'ปิด': 'Close', 'อัปเดตแล้ว': 'Updated', 'ไลน์ใช้โปรเจกต์นี้แล้ว': 'The line now uses this project', 'หยุดตรวจบนไลน์': 'Line inspection stopped',
  // monitor
  'ทำงานเหมือน PLC ส่ง COMMAND1 — ผลถูกส่งไป PLC ด้วย': 'Same as the PLC sending COMMAND1 — the result goes to the PLC too',
  'AI บนภาพสด': 'AI on live view', 'เสียงเตือน NG': 'NG alarm sound', 'เต็มจอ': 'Full screen', 'ออก': 'Exit', 'โหมดจอไลน์': 'Kiosk mode',
  'NG — เสียงเตือนดังอยู่': 'NG — alarm sounding', 'รับทราบ / หยุดเสียง': 'Acknowledge / silence',
  'คลิกที่หน้าจอ 1 ครั้งเพื่อเปิดเสียงเตือน (เบราว์เซอร์ไม่ให้เล่นเสียงก่อนผู้ใช้กด)': 'Click the screen once to enable the alarm sound (browsers block sound until the user interacts)',
  'รอ trigger…': 'Waiting for trigger…', 'ยังไม่มีภาพ — รอ trigger จาก PLC': 'No image yet — waiting for a PLC trigger', 'ภาพสด': 'Live view',
  'ตรวจวันนี้': 'Inspected today', 'ผลล่าสุด': 'Latest results', 'ได้รับ trigger แต่ไม่ได้ตรวจ — ไลน์ไม่ได้ใช้โปรเจกต์นี้หรือยังไม่มีโมเดล': 'Trigger received but not inspected — the line is not using this project, or there is no model',
  'ยังไม่มีโมเดลใช้งานจริง': 'No live model yet', '· AI ตรวจทุกเฟรม': '· AI on every frame', 'กล้องไม่ทำงาน': 'Camera not running',
  'ไลน์ไม่ได้ใช้โปรเจกต์นี้ — trigger จาก PLC จะไม่ถูกตรวจและไม่มีการตอบกลับ': 'The line is not using this project — PLC triggers are not inspected and get no reply',
  'โหมดเก็บภาพ — ยังไม่มีโมเดลใช้งานจริง ไม่ส่งผลไป PLC': 'Capture mode — no live model yet, nothing sent to the PLC',
  'ยังไม่มีโมเดลใช้งานจริง — PLC จะไม่ได้รับผล (deploy ที่หน้า Deploy)': 'No live model yet — the PLC gets no result (deploy on the Deploy page)',
  'ยังไม่มีผล': 'No results yet', 'เก็บภาพแล้ว': 'Image saved', 'ยังไม่มีโมเดลบนไลน์': 'no model on the line yet', 'ไม่พบตำหนิ': 'No defect found',
  'ยังไม่ส่งผลไป PLC': 'not sent to the PLC', 'ภาพชิ้นงานล่าสุดที่ตรวจ': 'Last inspected part', '· ส่ง PLC:': '· to PLC:',
  'Language / ภาษา': 'Language',
  'แก้กรอบ: คลิกกรอบเพื่อเลือก · ลากเพื่อย้าย · ลากมุมสีขาวเพื่อปรับขนาด · เปลี่ยน class จากรายการทางขวาหรือกด 1–9 · Del ลบ': 'Edit boxes: click a box to select · drag to move · drag a white corner to resize · change class in the list on the right or press 1–9 · Del deletes',
  'AI ช่วย label': 'AI-assisted labeling', 'โมเดล': 'Model', 'ความมั่นใจขั้นต่ำ': 'Min. confidence',
  'กรอบที่ AI เสนอเป็นเส้นประ — ยอมรับ แก้ หรือลบได้': 'AI boxes are dashed — accept, edit or delete them',
  'เสนอกรอบอัตโนมัติเมื่อเปิดภาพที่ยังไม่มีกรอบ': 'Suggest boxes when opening an image without boxes', 'ให้ AI เสนอกรอบภาพนี้ใหม่': 'Re-suggest boxes for this image',
  'ยอมรับกรอบนี้': 'Accept this box', 'ลบกรอบนี้': 'Delete this box', 'ไม่พบโมเดลนี้': 'Model not found',
  'histogram ของ': 'Histogram of', 'ทุก class (คะแนนสูงสุด)': 'all classes (top score)', 'แยกตามประเภทตำหนิ': 'Per defect type',
  'ปรับ threshold แยกตาม class': 'Separate threshold per class', 'threshold ทุก class (ปรับพร้อมกัน)': 'threshold for all classes (moves together)',
  'threshold ทุก class': 'threshold for all classes',
  '— สุ่มดัดแปลงภาพตอนเทรน ให้โมเดลทนแสง/ตำแหน่งที่เปลี่ยน (ไม่ได้สร้างตำหนิแบบใหม่)': '— random image changes during training so the model copes with lighting/position changes (it does not create new defect types)',
  'เว้นว่าง = ใช้ค่าของ preset · base model ที่วางไว้ในโฟลเดอร์ models/ จะใช้แทนการดาวน์โหลด · ค่าเริ่มต้น augmentation อยู่ใน settings.json → training.augment': 'Blank = preset value · a base model placed in models/ is used instead of downloading · augmentation defaults are in settings.json → training.augment',
  'ย่อ/ขยาย ± (scale)': 'Zoom ± (scale)', 'เลื่อนภาพ ± (translate)': 'Shift ± (translate)', 'หมุน ± องศา (degrees)': 'Rotate ± degrees (degrees)',
  'พลิกซ้าย-ขวา (fliplr)': 'Flip left-right (fliplr)', 'พลิกบน-ล่าง (flipud)': 'Flip up-down (flipud)', 'ความสว่าง ± (hsv_v)': 'Brightness ± (hsv_v)',
  'ความอิ่มสี ± (hsv_s)': 'Saturation ± (hsv_s)', 'โทนสี ± (hsv_h)': 'Hue ± (hsv_h)', 'ค่า default ของ Ultralytics': 'Ultralytics defaults',
  '· เลื่อนซ้าย = เข้มงวด (หลุดน้อย แจ้งผิดมาก) · เลื่อนขวา = ผ่อน': '· Left = strict (fewer misses, more false alarms) · Right = lenient',
  // server messages
  'ไม่พบข้อมูล': 'Not found', 'ต้องมีอย่างน้อย 1 class': 'At least 1 class is required', 'ชื่อ class ซ้ำกัน': 'Duplicate class names',
  'ไม่เกิน 9 class ต่อโปรเจกต์ (ใช้คีย์ 1–9)': 'At most 9 classes per project (keys 1–9)',
  'มีกรอบที่ label ไว้แล้ว — เพิ่ม class ต่อท้ายได้ แต่ห้ามลบหรือเรียงใหม่': 'Boxes are already labeled — you can append classes but not delete or reorder them',
  'class ไม่ถูกต้อง': 'Invalid class', 'อ่านไฟล์ภาพไม่ได้': 'Cannot read the image file',
  'ยังไม่มีโมเดล — เทรนโหมดเร็วสักครั้งก่อน (label ประมาณ 30 ภาพ)': 'No model yet — train once in Fast mode first (label about 30 images)',
  'threshold ต้องอยู่ระหว่าง 0.01–0.99': 'Threshold must be between 0.01 and 0.99', 'ไม่มีไฟล์': 'No file', 'โมเดลนี้ยังเทรนไม่เสร็จ': 'This model has not finished training',
  'ไม่ได้เก็บภาพของชิ้นนี้': 'No image was saved for this part', 'verdict ต้องเป็น ok หรือ ng': 'verdict must be ok or ng',
  'ยังไม่มีภาพที่มีกรอบตำหนิเลย': 'No images with defect boxes yet', 'มีงานเทรนกำลังทำอยู่ — รอให้เสร็จหรือกดยกเลิกก่อน': 'A training job is running — wait for it or cancel it first',
  'ไม่พบกล้อง Daheng (ตรวจสาย USB3 / ปิด Galaxy Viewer ก่อน)': 'No Daheng camera found (check the USB3 cable / close Galaxy Viewer)',
  'Simulated camera (ไม่มีฮาร์ดแวร์)': 'Simulated camera (no hardware)', 'กล้องไม่ส่งภาพ': 'Camera sends no images', 'กล้องไม่ได้เปิด': 'camera not started',
};

const I18N_PATTERNS = [
  // shell / generic
  [/^(\d+) วินาที$/, '$1 s'], [/^(\d+) นาที$/, '$1 min'], [/^([\d.]+) ชม\.$/, '$1 h'],
  [/^เทรน v(\d+) (\d+)%$/, 'Training v$1 $2%'], [/^กล้อง ([\d.]+) fps$/, 'Camera $1 fps'],
  // project
  [/^(.*) · (\d+) ภาพ · ใช้งานจริง v(\d+)$/, '$1 · $2 images · live v$3'], [/^(.*) · (\d+) ภาพ · ยังไม่ deploy$/, '$1 · $2 images · not deployed'],
  // capture
  [/^ไป Label \((\d+) ภาพรอ\) →$/, 'Go to Label ($1 waiting) →'],
  [/^ทั้งหมด (\d+) ภาพ · รอ label (\d+) · รอตรวจจากไลน์ (\d+)$/, 'Total $1 images · to label $2 · to review from line $3'],
  [/^label แล้ว · (\d+) กรอบ$/, 'labeled · $1 boxes'], [/^กล้องไม่ทำงาน: (.*)$/, 'Camera not running: $1'],
  [/^กำลังอัปโหลด (\d+) \/ (\d+)$/, 'Uploading $1 / $2'], [/^เพิ่ม (\d+) ภาพ(.*)$/, m => `Added ${m[1]} images` + m[2].replace(/· ข้ามไฟล์ซ้ำ (\d+)/, '· skipped duplicates $1').replace(/· อ่านไม่ได้ (\d+)/, '· unreadable $1')],
  [/^• (.*)$/, m => '• ' + trCore(m[1])],
  [/^(.+) มี (\d+) ภาพ ต่ำกว่าที่แนะนำ \((\d+)\) — ต้องการอีก (\d+) ภาพ$/, '$1 has $2 images, below the recommended $3 — $4 more needed'],
  [/^ชิ้นงานดีมากกว่า class ที่น้อยที่สุด (\d+) เท่า \(class ไม่สมดุล\)$/, 'Good parts outnumber the smallest class $1× (unbalanced classes)'],
  // label
  [/^โมเดลช่วย label: v(\d+)$/, 'Labeling helper: v$1'], [/^ภาพ (\d+) \/ (\d+)$/, 'Image $1 / $2'], [/^รอยืนยัน (\d+) กรอบ$/, '$1 boxes pending'],
  [/^\(AI ([\d.]*)\)$/, '(AI $1)'], [/^(.*) \(AI ([\d.]*)\)$/, '$1 (AI $2)'],
  // train
  [/^(.*) · (\d+)px · เหมาะลองดูว่าภาพพอไหม \/ ใช้เป็นโมเดลช่วย label$/, '$1 · $2px · check whether you have enough images / labeling helper'],
  [/^(.*) · (\d+)px · ใช้จริงหน้าไลน์$/, '$1 · $2px · for production'],
  [/^กำลังเทรน v(\d+)$/, 'Training v$1'], [/^(.+) · รอบ (\d+)\/(\d+)( · )?$/, m => `${trCore(m[1])} · epoch ${m[2]}/${m[3]}${m[4] || ''}`],
  [/^ลองใหม่ครั้งที่ (\d+)$/, 'retry $1'], [/^\(fp32\)$/, '(fp32)'], [/^\(ปิด cuDNN\)$/, '(cuDNN off)'],
  [/^v(\d+) · (\d+)% — รอให้เสร็จก่อน$/, 'v$1 · $2% — wait for it to finish'],
  [/^ล่าสุด: v(\d+) เสร็จแล้ว$/, 'Latest: v$1 finished'], [/^ล่าสุด: v(\d+) ถูกยกเลิก$/, 'Latest: v$1 cancelled'], [/^ล่าสุด: v(\d+) ไม่สำเร็จ$/, 'Latest: v$1 failed'],
  [/^(\d+) \/ (\d+) จาก (\d+)$/, '$1 / $2 of $3'], [/^ทดสอบ (\d+) ชิ้น ที่ threshold ([\d.]+):$/, 'Tested $1 parts at threshold $2:'],
  [/^หลุด (\d+)$/, 'missed $1'], [/^· แจ้งผิด (\d+)$/, '· false alarms $1'],
  [/^label แล้ว (\d+) ภาพ \(ชิ้นงานดี (\d+) ภาพ\)( — ต้องมีอย่างน้อย 20 ภาพ)?$/, m => `${m[1]} images labeled (${m[2]} good parts)` + (m[3] ? ' — at least 20 needed' : '')],
  [/^ยังไม่ label (\d+) ภาพ — จะไม่ถูกใช้เทรนรอบนี้$/, '$1 images not labeled — not used in this training'],
  [/^(.+) มี (\d+) ภาพ ต่ำกว่าที่แนะนำ \((\d+)\) — เทรนได้ แต่จะจับ (.+) ได้น้อย$/, '$1 has $2 images, below the recommended $3 — you can train, but it will catch few $4'],
  [/^(.+) ยังไม่มีภาพ — โมเดลจะจับ class นี้ไม่ได้$/, '$1 has no images — the model cannot catch this class'],
  [/^แบ่งชุดเทรน\/ทดสอบอัตโนมัติ (\d+)\/(\d+) แยกตามประเภทตำหนิ$/, 'Automatic train/test split $1/$2, stratified by defect type'],
  [/^กรอบเล็กสุด (\d+) px \(≈(\d+) px ที่ขนาดเทรน (\d+)\)( — เล็กเกินไป ลองโหมดแม่นยำหรือเพิ่ม imgsz)?$/, m => `Smallest box ${m[1]} px (≈${m[2]} px at training size ${m[3]})` + (m[4] ? ' — too small, try Accurate mode or a larger imgsz' : '')],
  [/^ยังเทรนไม่ได้: (.*)$/, m => 'Cannot train yet: ' + m[1].split('; ').map(trCore).join('; ')],
  [/^ไม่มี preset '(.*)'$/, "No preset '$1'"],
  [/^augmentation (\w+) ต้องอยู่ระหว่าง (.*)$/, 'augmentation $1 must be between $2'],
  [/^augment: (.*)$/, m => 'augment: ' + trCore(m[1])],
  [/^v(\d+) \((เร็ว|แม่นยำ|.*?)\)( · ใช้งานจริง| · shadow)?$/, m => `v${m[1]} (${m[2] === 'เร็ว' ? 'fast' : m[2] === 'แม่นยำ' ? 'accurate' : m[2]})${m[3] === ' · ใช้งานจริง' ? ' · live' : m[3] || ''}`],
  [/^class ของกรอบที่ (\d+)$/, 'class of box $1'],
  [/^threshold ของ (.+)$/, 'threshold for $1'],
  [/^จับได้ (\d+) \/ (\d+) · แจ้งผิด (\d+)$/, 'caught $1 / $2 · false alarms $3'], [/^ไม่มีภาพทดสอบ · แจ้งผิด (\d+)$/, 'no test images · false alarms $1'],
  [/^ภาพที่ไม่มี (.+)$/, 'images without $1'], [/^ภาพที่มี (.+)$/, 'images with $1'],
  [/^v(\d+) ใช้ threshold แยกตาม class แล้ว(.*)$/, m => `v${m[1]} now uses per-class thresholds` + (m[2] ? ' (applies to the line immediately)' : '')],
  [/^base model '(.*)' ต้องลงท้ายด้วย \.pt เช่น yolo26l\.pt$/, "base model '$1' must end in .pt, e.g. yolo26l.pt"],
  // results
  [/^ทดสอบกับภาพที่โมเดลไม่เคยเห็น (\d+) ภาพ \(มีตำหนิ (\d+) · ชิ้นดี (\d+)\)(.*)$/, m => `Tested on ${m[1]} images the model never saw (${m[2]} defective · ${m[3]} good)` + (m[4] ? ' — few test images, numbers can swing a lot' : '')],
  [/^\/ (\d+) ชิ้น$/, '/ $1 parts'], [/^threshold ([\d.]+) \(ใช้อยู่\)$/, 'threshold $1 (in use)'], [/^ใช้ threshold นี้กับ v(\d+)$/, 'Use this threshold for v$1'],
  [/^inference ([\d.]+) ms\/ภาพ · train (\d+) \/ val (\d+)$/, 'inference $1 ms/image · train $2 / val $3'],
  [/^คะแนน ([\d.]+)(.*)$/, 'score $1$2'], [/^v(\d+) ใช้ threshold ([\d.]+) แล้ว(.*)$/, m => `v${m[1]} now uses threshold ${m[2]}` + (m[3] ? ' (applies to the line immediately)' : '')],
  // deploy
  [/^Shadow: v(\d+) รันคู่ v(\d+)$/, 'Shadow: v$1 beside v$2'], [/^Shadow: v(\d+) รันคู่ \(ยังไม่มีตัวใช้งานจริง\)$/, 'Shadow: v$1 (no live model yet)'],
  [/^v(\d+) จับ NG มากกว่า v(\d+)$/, 'v$1 caught more NG than v$2:'], [/^ชิ้น · ปล่อยผ่านมากกว่า$/, 'parts · passed more:'],
  [/^ชิ้น( — ควรดู (\d+) ชิ้นนี้ก่อนอนุมัติ)?$/, m => 'parts' + (m[1] ? ` — check these ${m[2]} before approving` : '')],
  [/^ดู (\d+) ชิ้นที่ผลต่างกัน$/, 'See $1 disagreements'], [/^อนุมัติให้ v(\d+) สั่ง reject ผ่าน PLC$/, 'Approve v$1 to reject via the PLC'],
  [/^ใช้งานจริง: v(\d+)$/, 'Live: v$1'], [/^threshold ([\d.]+) · deploy เมื่อ (.*)$/, 'threshold $1 · deployed $2'],
  [/^(.*) — เวอร์ชันใหม่ให้กด$/, m => trCore(m[1]) + ' — for a new version press'], [/^ก่อน เพื่อรันคู่โดยยังไม่สั่ง reject$/, 'first, to run it alongside without rejecting'],
  [/^ทำงานเหมือน PLC ส่ง (.*)$/, 'Same as the PLC sending $1'],
  [/^(.*) \(ใช้อยู่\)$/, '$1 (in use)'],
  [/^ผล: (.*)$/, m => 'Result: ' + m[1].replace('ไม่ส่ง PLC', 'not sent to PLC')],
  [/^คิวรอตรวจจากไลน์จริง · (\d+) ภาพ$/, 'Review queue from the line · $1 images'],
  [/^ภาพที่โมเดลไม่แน่ใจ \(คะแนน ([\d.]+)–([\d.]+)\) · กด OK = ชิ้นดี, NG = ส่งไป label · ตรวจแล้ว (\d+) ภาพตั้งแต่เทรนครั้งล่าสุด$/, 'Images the model was unsure about (score $1–$2) · OK = good part, NG = send to Label · $3 reviewed since the last training'],
  [/^ตรวจครบ (\d+) ภาพ เทรนรอบใหม่อัตโนมัติ \(ใช้เฉพาะภาพที่ label แล้ว\)$/, 'Retrain automatically after $1 reviews (labeled images only)'],
  [/^ให้ v(\d+) สั่ง OK\/NG ไปที่ PLC จริง\?$/, 'Let v$1 send OK/NG to the real PLC?'],
  [/^เริ่มรัน v(\d+) คู่กับตัวปัจจุบัน \(ยังไม่สั่ง reject\)\?$/, 'Start running v$1 beside the current model (no rejecting yet)?'], [/^หยุด shadow v(\d+)\?$/, 'Stop shadow v$1?'],
  [/^live (\S+)$/, 'live $1'],
  // monitor
  [/^● (.*) · ([\d.]+) fps(.*)$/, m => `● ${trCore(m[1])} · ${m[2]} fps${m[3] ? ' · ' + trCore(m[3].replace(/^ · /, '')) : ''}`],
  [/^· ตรวจ ([\d.]+) ms · ส่ง PLC:$/, '· inspected in $1 ms · to PLC:'],
  [/^\((\d+) ชิ้นตั้งแต่กดรับทราบครั้งล่าสุด\)$/, '($1 parts since last acknowledged)'],
  [/^NG — (.*?)( \((\d+) ชิ้นตั้งแต่กดรับทราบครั้งล่าสุด\))?$/, m => `NG — ${m[1]}` + (m[2] ? ` (${m[3]} parts since last acknowledged)` : '')],
  [/^NG \((\d+) ชิ้นตั้งแต่กดรับทราบครั้งล่าสุด\)$/, 'NG ($1 parts since last acknowledged)'],
  [/^โมเดล v(\d+) · threshold ([\d.]+)(.*)$/, 'Model v$1 · threshold $2$3'], [/^ให้ไลน์ใช้ (.+)$/, 'Use $1 on the line'],
  [/^· ตรวจ ([\d.]+) ms$/, '· inspected in $1 ms'], [/^· คะแนนสูงสุด ([\d.]+)$/, '· top score $1'],
  [/^(.*) · ตรวจ ([\d.]+) ms · ส่ง PLC:$/, '$1 · inspected in $2 ms · to PLC:'],
  [/^S:(OK|NG)$/, 'S:$1'],
  // server
  [/^ยังไม่มีภาพจากกล้อง: (.*)$/, m => 'No camera image yet: ' + trCore(m[1])],
  [/^เปิด webcam index (\d+) ไม่ได้ \(ลอง backend msmf หรือ index อื่น\)$/, 'Cannot open webcam index $1 (try backend msmf or another index)'],
  [/^โหลด SAM ไม่ได้ \((.*?)\): (.*)$/, 'Cannot load SAM ($1): $2'], [/^ส่งผลไป PLC (.*) ไม่ได้: (.*)$/, 'Cannot send results to PLC $1: $2'],
  [/^bind (.*) ไม่ได้: (.*)$/, 'Cannot bind $1: $2'],
  [/^(.*)\n\n--- (.*) \(ท้ายไฟล์\) ---\n([\s\S]*)$/, '$1\n\n--- $2 (end of file) ---\n$3'],
];

window.__i18nMissing = new Set();
function trCore(s) {
  if (LANG() !== 'en' || !THAI.test(s)) return s;
  if (I18N_EXACT[s] !== undefined) return I18N_EXACT[s];
  for (const [re, rep] of I18N_PATTERNS) {
    const m = s.match(re);
    if (m) return typeof rep === 'function' ? rep(m) : s.replace(re, rep);
  }
  window.__i18nMissing.add(s);
  return s;
}
function tr(s) {   // keeps the node's leading/trailing whitespace
  if (LANG() !== 'en' || !s || !THAI.test(s)) return s;
  const m = s.match(/^(\s*)([\s\S]*?)(\s*)$/);
  return m[1] + trCore(m[2]) + m[3];
}

const I18N_ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];
function translateTree(root) {
  if (LANG() !== 'en') return;
  if (root.nodeType === Node.TEXT_NODE) { const t = tr(root.nodeValue); if (t !== root.nodeValue) root.nodeValue = t; return; }
  if (root.nodeType !== Node.ELEMENT_NODE || root.tagName === 'SCRIPT' || root.tagName === 'STYLE') return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n = root;
  while (n) {
    if (n.nodeType === Node.TEXT_NODE) {
      if (THAI.test(n.nodeValue) && !n.parentElement?.closest('[data-noi18n],select#projSel')) { const t = tr(n.nodeValue); if (t !== n.nodeValue) n.nodeValue = t; }
    } else {
      for (const a of I18N_ATTRS) { const v = n.getAttribute && n.getAttribute(a); if (v && THAI.test(v)) { const t = tr(v); if (t !== v) n.setAttribute(a, t); } }
    }
    n = walker.nextNode();
  }
}
const i18nObserver = new MutationObserver(muts => {
  if (LANG() !== 'en') return;
  for (const m of muts) {
    if (m.type === 'childList') m.addedNodes.forEach(translateTree);
    else if (m.type === 'characterData') translateTree(m.target);
    else if (m.type === 'attributes') translateTree(m.target);
  }
});
function startI18n() {
  document.documentElement.lang = LANG();
  translateTree(document.body);
  i18nObserver.observe(document.body, {childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: I18N_ATTRS});
}
const _confirm = window.confirm.bind(window);
window.confirm = msg => _confirm(tr(msg));
function langToggleHtml() {
  const l = LANG();
  return `<span class="lang" data-noi18n role="group" aria-label="Language / ภาษา"><button type="button" data-lang="th" class="${l === 'th' ? 'on' : ''}" aria-pressed="${l === 'th'}">ไทย</button><button type="button" data-lang="en" class="${l === 'en' ? 'on' : ''}" aria-pressed="${l === 'en'}">EN</button></span>`;
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-lang]');
  if (!b || b.dataset.lang === LANG()) return;
  localStorage.setItem('vt_lang', b.dataset.lang);
  location.reload();     // simplest way to re-render everything in the other language
});
