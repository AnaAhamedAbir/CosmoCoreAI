import { useEffect, useState } from 'react';
import {
  DeviceThermalProfile,
  getThermalProfile,
  subscribeThermalProfile,
  syncThermalDocumentClass,
} from '@/utils/deviceProfile';

export function useDeviceProfile(): DeviceThermalProfile {
  const [profile, setProfile] = useState<DeviceThermalProfile>(() => getThermalProfile());

  useEffect(() => {
    setProfile(syncThermalDocumentClass());
    return subscribeThermalProfile((next) => {
      setProfile(next);
    });
  }, []);

  return profile;
}

