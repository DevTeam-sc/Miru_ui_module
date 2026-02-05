# โครงงาน: Miru UI Module (Miru Next)
**ผู้จัดทำ:** DevSKY & Miruko Team  
**เวอร์ชัน:** 5.1 (Alpha)

---

## 1. บทคัดย่อ (Abstract)

โครงงานนี้จัดทำขึ้นเพื่อพัฒนา **Miru UI Module** ซึ่งเป็นเครื่องมือตรวจสอบความปลอดภัยแอปพลิเคชันบนระบบปฏิบัติการ Android (Mobile Security Assessment Tool) ที่ทำงานผ่าน Web Interface โดยมีจุดประสงค์เพื่อลดความซับซ้อนในการใช้งานเครื่องมือรูปแบบ Command Line (CLI) เดิม 

ระบบถูกออกแบบให้ทำงานเป็น Module สำหรับ KernelSU/Magisk โดยใช้สถาปัตยกรรมแบบ **Hybrid Bridge** ที่ผสานการทำงานระหว่าง Native KernelSU API และ CGI Web Server (Busybox httpd) ทำให้สามารถควบคุมการทำงาน ดูสถานะ และรันสคริปต์ตรวจสอบความปลอดภัย (Bypass Scripts) ได้จากทั้งบนหน้าจอมือถือและเว็บเบราว์เซอร์บนคอมพิวเตอร์ ผลการทดสอบแสดงให้เห็นว่าระบบช่วยลดระยะเวลาในการเตรียม Environment และวิเคราะห์แอปพลิเคชันได้อย่างมีนัยสำคัญ พร้อมทั้งรองรับการทำงานร่วมกับเครื่องมือมาตรฐาน เช่น Frida และ Zygisk

---

## 2. บทนำ (Introduction)

### 2.1 ที่มาและความสำคัญ
ในปัจจุบัน แอปพลิเคชันทางการเงิน (Mobile Banking) มีมาตรการป้องกันความปลอดภัยที่เข้มข้น เช่น การตรวจจับ Root, การป้องกันการแก้ไขโค้ด (Tamper Detection), และการเข้ารหัสข้อมูล การตรวจสอบความปลอดภัยเพื่อค้นหาช่องโหว่จึงต้องใช้เครื่องมือหลายชนิดทำงานร่วมกัน (Frida, ADB, Shell Scripts)

### 2.2 ปัญหาของเครื่องมือเดิม
จากการศึกษาพบว่ากระบวนการทดสอบความปลอดภัยแบบเดิมมีข้อจำกัด:
1.  **ความซับซ้อน:** ผู้ทดสอบต้องจำคำสั่งจำนวนมากและพิมพ์ผ่าน Terminal
2.  **ความล่าช้า:** การสลับหน้าจอมือถือเพื่อดูผลลัพธ์และกลับมาแก้โค้ดบนคอมพิวเตอร์ทำได้ไม่สะดวก
3.  **ความเข้ากันได้:** เครื่องมือบางตัวไม่รองรับการทำงานบน Android รุ่นใหม่ หรือ KernelSU

คณะผู้จัดทำจึงพัฒนา **Miru UI Module** เพื่อรวบรวมเครื่องมือเหล่านี้มาไว้บนหน้าเว็บเดียว (Unified Web Interface)

---

## 3. วัตถุประสงค์ (Objectives)

1.  เพื่อพัฒนาเครื่องมือตรวจสอบความปลอดภัย Android ที่ใช้งานผ่าน Web Browser (Web-based Interface)
2.  เพื่อศึกษาและประยุกต์ใช้เทคนิค **Hybrid Bridge** ในการเชื่อมต่อระหว่าง Web Frontend และ Root Backend
3.  เพื่อเพิ่มประสิทธิภาพในการวิเคราะห์การทำงานของแอปพลิเคชัน (Dynamic Analysis) โดยลดขั้นตอน Manual Operation
4.  เพื่อสร้างระบบที่รองรับการอัปเดตสคริปต์ตรวจสอบ (Bypass Scripts) ได้อย่างยืดหยุ่น

---

## 4. วิธีดำเนินงาน (Methodology)

### 4.1 สถาปัตยกรรมระบบ (System Architecture)
ระบบทำงานแบบ Client-Server ภายในเครื่อง Android (Localhost) แบ่งเป็น 3 ชั้น:

1.  **Frontend Layer (User Interface):**
    *   พัฒนาด้วย HTML5, CSS3 (Glassmorphism Design), และ JavaScript (Vanilla)
    *   ไฟล์หลัก: `webroot/index.html` (App List), `webroot/ide.html` (Code Editor)
    *   รองรับการแสดงผลแบบ Responsive บนมือถือและ Desktop

2.  **Bridge Layer (Communication):**
    *   **Native KSU Bridge:** ใช้ `window.ksu.exec` เมื่อรันบน KernelSU Manager เพื่อความเร็วสูงสุด
    *   **CGI HTTP Bridge:** ใช้ `fetch` ยิงไปที่ `/cgi-bin/exec` (Busybox httpd) เมื่อรันบน Browser ทั่วไป (Port 9090)
    *   **Base64 Encoding:** ใช้การเข้ารหัส Output เป็น Base64 ก่อนส่งกลับเพื่อป้องกันปัญหาตัวอักษรพิเศษ (Special Characters)

3.  **Execution Layer (Backend):**
    *   ใช้ Shell Scripts (`sh`) ในการควบคุมระบบ (Start/Stop App, Inject Frida)
    *   จัดการ Config ผ่านไฟล์ JSON (`/data/adb/miru_ui_module/config.json`)

### 4.2 กระบวนการทำงาน (Workflow)
1.  **Environment Scan:** ระบบตรวจสอบสภาพแวดล้อม (Root, Busybox, Tools)
2.  **App Selection:** ผู้ใช้เลือกแอปเป้าหมายจากรายการ
3.  **Execution:** ระบบเตรียม Environment (Hide Root/Mount) และรันแอปพร้อม Inject Script
4.  **Monitoring:** แสดงผล Log (stdout/stderr) แบบ Real-time บนหน้าเว็บ

---

## 5. ผลการดำเนินงาน (Results)

ระบบ Miru UI Module สามารถทำงานได้ตามขอบเขตที่กำหนด:
1.  **Web Interface:** สามารถแสดงรายชื่อแอปพลิเคชัน และสถานะระบบได้ถูกต้อง
2.  **Command Execution:** สามารถสั่งรันคำสั่ง Root และรับผลลัพธ์กลับมาแสดงผลได้ 100% ผ่านทั้ง Native และ CGI Bridge
3.  **Cross-Platform:** ใช้งานได้เสถียรทั้งบน Android WebView และ Chrome Desktop
4.  **Performance:** ใช้ทรัพยากรเครื่องน้อยมาก เนื่องจากใช้ `busybox httpd` แทน Web Server ขนาดใหญ่ (Node.js/Python)

---

## 6. สรุปผลและข้อเสนอแนะ (Conclusion & Future Work)

### 6.1 สรุปผล
Miru UI Module ประสบความสำเร็จในการนำเสนอวิธีการใหม่ในการควบคุมเครื่องมือ Root บน Android ช่วยให้ผู้ทดสอบความปลอดภัยสามารถทำงานได้สะดวกและรวดเร็วขึ้น โดยไม่ต้องพึ่งพาการพิมพ์คำสั่งซ้ำซ้อน

### 6.2 ข้อเสนอแนะและแผนการพัฒนาต่อ
เพื่อให้ระบบมีความสมบูรณ์ยิ่งขึ้น คณะผู้จัดทำมีแผนการปรับปรุงตามลำดับความสำคัญ ดังนี้:

1.  **ระยะที่ 1: เสถียรภาพระบบ (System Stability & Core)** - *ดำเนินการทันที*
    *   **Dependency Isolation:** ผนวก `busybox` (Static Binary) มาในโมดูลเพื่อลดปัญหา Version Mismatch ในแต่ละเครื่อง
    *   **Code Optimization:** ปรับปรุง CGI Script ให้จัดการ Memory และ Process ได้ดียิ่งขึ้น ป้องกันการค้างเมื่อรันงานหนัก
    *   **Error Handling:** เพิ่มระบบตรวจสอบข้อผิดพลาดที่ละเอียดขึ้น แจ้งเตือนผู้ใช้เมื่อคำสั่งล้มเหลว

2.  **ระยะที่ 2: ฟีเจอร์การใช้งาน (Feature Expansion)**
    *   **Cloud Script Store:** ระบบดึงสคริปต์ Bypass ล่าสุดจาก Server
    *   **File Manager:** เครื่องมือจัดการไฟล์ Data/Database ของแอปผ่านเว็บ

3.  **ระยะที่ 3: ความปลอดภัย (Security Hardening)**
    *   **Authentication:** เพิ่มระบบ Token/Password ก่อนเข้าใช้งาน WebUI (เมื่อระบบเสถียรแล้ว)
    *   **Access Control:** จำกัดการเชื่อมต่อ IP และ Port ให้รัดกุมยิ่งขึ้น
